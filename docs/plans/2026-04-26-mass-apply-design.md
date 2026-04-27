# Mass-Apply Platform — Design

Date: 2026-04-26
Status: Design approved, awaiting implementation plan
Scope: Single-tenant (one user — Moiz). Evolves HireScript from a tailoring tool into an end-to-end personal job-application engine.

## Goal

Turn HireScript into a personal mass-apply platform that knows everything about Moiz, discovers relevant jobs across many sources, tailors a one-page resume for each, and submits the application — autonomously by default, with a per-job toggle to fall back to human review.

The existing HireScript engine (LaTeX master resume → tailor → Tectonic compile → one-page enforcer) is reused unchanged as the resume-generation step inside the apply pipeline. No parallel resume engine.

## Product decisions (locked)

| Area | Decision |
|---|---|
| Submission mode | A (autonomous) by default, per-job toggle to B (human-in-loop). B-mode runs the same pipeline but stops at the final submit button. |
| Job sources | All in scope: ATS direct (Greenhouse, Lever, Ashby, Workable), aggregator APIs, LinkedIn/Indeed/Wellfound scraping (feature-flagged), email digest ingestion, URL paste, agentic discovery, GitHub-curated lists (`SimplifyJobs/New-Grad-Positions` and similar community-maintained markdown tables). Pluggable `Source` adapters behind one normalized `Job` schema. |
| No double-apply | Hard invariant. Every applied job is recorded with a stable identity key `(canonical_company, canonical_role_or_url)`. The submit step refuses to fire if that key already exists in `applications` with status ≠ rejected-cooldown-expired. Reposted listings (same role, new `source_job_id`) collapse to the existing key via a Haiku canonicalizer. Reapply only after the configurable cooldown (default infinite for v1; future: 90 days post-rejection). |
| Profile / KB | Layered: structured profile (typed Pydantic, source of truth for form fields and ATS data) + free-form KB (markdown, RAG'd at tailor time, source of truth for narrative). Conversational onboarding bootstraps the profile. |
| KB sources | Master LaTeX, Notion (scoped — specific DBs/pages, not whole vault), personal website (allow/deny path patterns), GitHub READMEs, manual markdown notes. |
| Apply policy | Tiered: `dream` / `targeted` / `wide_net` / `skip`. Each tier has its own model, research depth, daily cap, and default submission mode. v1 ships dream + targeted; wide_net + spray added later. |
| Submission mechanics | Hybrid: hand-coded Playwright adapters for top 4–5 ATSs (volume); Claude browser-agent fallback for unknown portals (coverage). Adapter failure auto-promotes to agent. |
| Captcha / MFA | Pause and ping the user (push). No captcha-solving services. |
| Post-apply | Fire and forget. No status pipeline, no recruiter-mail ingestion, no follow-ups for v1. Application-level dedup via `(source, source_job_id)`. |
| Anthropic auth | Two paths via a `claude_router`: Max-authenticated Agent SDK for heavy long-running work (tailor, research, browser agent, KB ingest); API key for short, latency-critical, or overflow tasks (classify, cheap Haiku). |

## Architecture

Six Docker Compose services, evolving the existing three.

- `web` (existing, expanded) — React. Adds inbox, review queue, profile/KB editor, history, onboarding chat.
- `api` (existing, expanded) — FastAPI. System of record. New endpoints for jobs, applications, profile, KB, tiers, sources.
- `db` (existing) — Postgres + pgvector. New tables: `jobs`, `applications`, `profile`, `kb_documents`, `kb_chunks`, `tiers`, `source_configs`, `answer_cache`, `companies`.
- `worker` (new) — Python worker pool (Arq on Redis). Source pollers, apply pipeline, browser-agent driver. All long-running work lives here.
- `browser` (new) — Playwright server. Worker drives over CDP. Isolated container so misbehaving pages can't kill the worker.
- `redis` (new) — queue, distributed locks, hot answer cache, Max-window rate-limit counter.

Auth model and the single-tenant invariant from CLAUDE.md (`user_id = 1`, signed session cookie) carry forward unchanged.

## Apply pipeline (one job's lifecycle)

Each stage is a worker task with its own retry and idempotency key. Stages are independently restartable.

1. **Ingest** — source adapter fetches → normalizes → upserts `jobs` row. Source-level dedup key: `(source, source_job_id)`. Adapter families: `greenhouse|lever|ashby|workable` (clean APIs), `linkedin|indeed|wellfound` (scraping, feature-flagged), `email` (IMAP + Haiku extraction), `url_paste` (single-page scrape), `agentic` (Claude + web search, daily budget), `github_curated` (community-maintained markdown tables — initial repo: `SimplifyJobs/New-Grad-Positions`; adapter clones/fetches the README, parses the rows, follows each apply link to extract the underlying ATS posting where possible so downstream submit can use the deterministic Playwright adapters; falls back to URL paste behavior for opaque destinations).

   **Application-level dedup runs alongside source-level dedup.** Same role posted to multiple sources (e.g. SimplifyJobs row links to a Greenhouse posting we also poll directly) collapses to one canonical job via `(canonical_company, canonical_role_or_url)`. The canonicalizer normalizes company name (lower, strip Inc./LLC) and the apply destination URL (resolve redirects, strip tracking params); a Haiku call disambiguates only when URL canonicalization is ambiguous. Multiple `jobs` rows can map to one canonical key — the submit step uses the canonical key, not the row id.
2. **Classify + tier** — Haiku call. Inputs: JD, profile, tier rules. Outputs: tier (`dream`/`targeted`/`wide_net`/`skip`), fit score 0–100. Skipped jobs persist but don't progress.
3. **Research** (dream tier only) — Sonnet/Opus + web search. Per-company brief: news, funding, team, network connections, Glassdoor signal. Cached per company for 30 days.
4. **Tailor** — existing HireScript engine. Inputs: master LaTeX, RAG'd KB chunks, structured profile, JD, tier-specific prompt. Output: tailored LaTeX → Tectonic → one-page enforcer loop → final PDF with `page_count == 1` invariant preserved.
5. **Generate cover letter + short-answers** — same KB+profile RAG, separate prompt. Short-answers cached in `answer_cache` keyed by question hash.
6. **Verify** — Haiku post-tailor pass. Diffs claims in the tailored resume against profile + KB. Blocks submission if it finds unsupported claims (no fabricated dates, titles, or accomplishments).
7. **Pre-submit gate** — re-check the canonical-key dedup index. If `applications` already has a row for this `(canonical_company, canonical_role_or_url)` whose status isn't past its rejection cooldown, refuse to submit and mark the job `duplicate_skipped` with a link to the prior application. This gate runs *here* (not just at ingest) so a race between two adapters ingesting the same role can't produce a double submission; the canonical key is enforced via a unique constraint on `applications`, so the DB itself rejects double inserts.
8. **Submit** — branches on per-job mode:
   - **A** — try Playwright adapter for detected ATS. On selector failure or unknown ATS, promote to Claude browser-agent. On captcha/MFA/"are you human", pause and ping. On success, store confirmation HTML + screenshot.
   - **B** — same flow, stops at final submit button. Surfaces in review queue. One click finishes it.
9. **Record** — write `applications` row: `(job_id, canonical_key, status, mode, resume_pdf_blob, cover_letter, form_payload, submitted_at, confirmation_artifacts)`. Unique index on `(user_id, canonical_key)` is the no-double-apply DB-level guarantee.

**Cadence** — sources on cron (15 min for ATS/email, nightly for scraping/agentic). Apply pipeline drains continuously, gated by per-tier daily caps and Max-window headroom. Manual kick from the inbox is always available.

**Failure handling** — every stage idempotent and retryable. Hard failures (3 retries) park in `needs_attention` queue surfaced in the web app. Never silently dropped.

## Profile + knowledge base

**Structured profile** (`profile` table, single row, typed Pydantic):
- Identity, contacts, links.
- Work auth (per-region sponsorship needed, willing-to-relocate map).
- Work history (structured because forms ask field-by-field), education, certifications, languages.
- Preferences: salary floor + target by location, role families, dealbreakers, company-stage, remote/hybrid/onsite tolerance per city.
- EEO defaults: pre-set answers so the user doesn't re-decide on every form.
- Per-application toggles: cover-letter default, salary-disclosure default, default mode per tier.

Edited via a structured form. Versioned. Form-fillers read directly — no Claude in the loop for "what's your phone number."

**Free-form KB** (`kb_documents` + `kb_chunks` with pgvector):
- Sources: master LaTeX, scoped Notion (specific DBs/pages), personal website (allow/deny patterns), GitHub READMEs, manual `kb/` markdown.
- Sync adapters on cron (Notion 6h, website nightly, GitHub nightly, manual on file change). Voyage embeddings (cheaper, Anthropic-recommended).
- Retrieval at tailor/cover-letter time: top-k by JD embedding similarity with metadata filters.

**Onboarding (option D)** — first run: Agent SDK session reads master LaTeX, fetches website, syncs Notion, indexes everything, drafts a `profile` row. Then runs an interview loop in the web app — Claude asks for the gaps it found and saves answers into the profile and as KB notes. Re-runnable any time.

## Anthropic auth + rate-limit strategy

`claude_router.choose(task)` returns the right client per task.

- **Max-authenticated Agent SDK** (default for heavy/long-running): tailor (Sonnet), dream-tier research (Sonnet/Opus), browser-agent submission (Sonnet), KB ingest + onboarding (Sonnet), overflow repair iter 3+ (Sonnet). $0 marginal, bound by 5-hour rolling rate windows.
- **API key** (overflow + latency-critical + dumb tasks): classification + tiering (Haiku), short-answer cache misses (Haiku), overflow repair iter 1–2 (Haiku), email digest extraction (Haiku), any other "extremely dumb" task. Pay-per-token, no rate-window risk.

Router tracks Max usage in Redis (rolling 5-hour counter). Near-limit, dream-tier research and browser-agent runs pause; classification and Haiku tasks keep flowing on the API key.

Token-bucket per `(tier, source)` caps throughput. Hard daily caps per tier are independent of Max headroom (so wide_net can't starve dream tier).

## Safety + legal posture

- ToS posture per source recorded and surfaced. ATS direct / email / URL paste are clean. LinkedIn scraping + Easy Apply automation are explicitly against ToS — feature-flagged with a clear opt-in.
- No captcha-solving services.
- **Identity honesty invariant**: nothing submitted is fabricated. Profile + KB is the source. Tailoring rephrases, never invents. Post-tailor verifier (step 6) blocks submission on unsupported claims.
- Per-company kill list (current employer, conflicts, never-again) excluded at ingest and double-checked at submit.
- Audit trail: every submission stores exact resume PDF, cover letter, form payload, and rendered confirmation page.

## Web UI surfaces (additive to existing resume editor)

### Design source (all slices)

**Authoritative design reference for every UI surface in this plan and all subsequent slices:**

- `https://api.anthropic.com/v1/design/h/eYoG49rlvB10YH7DYeCNgA` — fetch the bundle, read its README and `chats/chat1.md`, and treat the relevant screens as the visual + interaction contract for the surface being implemented.
- `design/handoffs/hirescript/` — the existing in-repo handoff. Continues to own already-shipped tokens (so existing components don't drift). The bundle wins for new surfaces and for the unified suite shell.

**Bundle organization → product mapping.** The bundle ships three prototype HTML files (`HireScript.html`, `Mass Apply.html`, `HireScript Suite.html`) only because the design tool iterated in stages. **The product is one app: `HireScript Suite`.** The other two are the per-job (resume editor) and mass-apply sub-screens that live *inside* the Suite under one top bar + grouped left nav + shared ⌘K. No iframes in production — everything runs in a single React SPA. Treat `HireScript Suite.html` as the integration target; treat the per-job and mass-apply files as the screen catalogues that source the surfaces.

**Process for every slice that touches UI:**

1. Before starting UI work, fetch the design bundle from the URL above and read `chats/chat1.md` (intent + final design decisions) and the relevant `*.jsx`/`*.css` files.
2. Identify the surfaces in the bundle that match what the slice is building or refreshing.
3. Reuse intent, layout, density, component hierarchy, typography, spacing, colors, and interaction patterns from the bundle.
4. Translate into production React/TypeScript inside the existing SPA. Recreate visually pixel-perfect; do not copy the prototype's iframe-mounting structure or its `*.jsx` runtime — those are prototype-only.
5. New design primitives go into `web/src/components/ui/` as the slice that introduces them lands. New tokens go into `web/src/styles/`.

The first time this is invoked is **Slice 2.5 — Suite Design Pass** (see `docs/plans/2026-04-26-suite-design-pass.md`). Slices 3+ inherit the suite shell + token system from there.

### Surfaces

- **Inbox** — firehose of ingested jobs. Tier, fit score, company, title, source, status, mode. Filterable. Per-job overrides (force B, skip, promote tier, pin).
- **Review queue** — B-mode jobs and A-mode jobs paused on captcha/MFA/agent-stuck. Each card: tailored PDF, cover letter, filled form summary, single submit button. Agent-stuck cards deep-link into the live browser session.
- **Profile + KB editor** — three tabs: structured profile form, KB sources + sync status, onboarding-interview chat.
- **History** — past applications with snapshots and confirmation artifacts.

**Notifications** — push via Pushover or ntfy (TBD). Triggers: agent stuck, B-mode review ready, source-adapter hard failure, daily summary.

## Build sequencing — five vertical slices

Each slice is end-to-end usable.

1. **Profile + KB foundation** — schema, manual profile editor, master-LaTeX + manual markdown ingestion, embedding pipeline, retrieval. Done when onboarding interview produces a usable profile + KB.
2. **One source + one ATS, B-only** — Greenhouse ingest adapter + Greenhouse Playwright submit adapter, mode locked to B. Full pipeline: ingest → classify → tailor (existing engine) → cover letter → review queue → one-click submit. Done when a Greenhouse job applies end-to-end from the inbox.
3. **Tiering + A-mode for one ATS** — tier classification, dream/targeted/wide_net policy, A-mode for Greenhouse, captcha-pause + ping. Done when wide_net Greenhouse jobs auto-apply overnight untouched.
4. **Source breadth** — Lever, Ashby, Workable adapters; email-digest ingestion; URL paste. Each ~few-hundred lines behind the same `Source` interface.
5. **Agent fallback + remaining sources** — Claude browser-agent for unknown ATSs, LinkedIn/Indeed/Wellfound scrapers (flagged), agentic discovery, dream-tier research, Notion + personal-website KB sync.

## Non-goals (v1)

- Multi-tenant abstractions. Single user, `user_id = 1` invariant preserved.
- Recruiter-mail ingestion, status pipeline, auto-reply drafts, follow-up automation.
- Captcha-solving service integration.
- Mobile app.
- Spray-tier policy.
- Anything not in the five slices above.

## Open questions for the implementation plan

- Notification channel: Pushover vs. ntfy.
- Embeddings provider: Voyage (recommended) vs. OpenAI vs. self-hosted.
- Worker queue: Arq (lightweight, asyncio-native, good fit) vs. Celery (heavier, better tooling).
- How to authenticate the Agent SDK with Max credentials inside a Docker worker — needs a one-time interactive login, then a stored session token mounted into the container.
- Browser-agent harness — Computer Use vs. Stagehand vs. browser_use vs. roll-our-own.

These are deferred to the implementation plan, which is the next step.
