# Mass-Apply Slice 5 — Agent Fallback + Remaining Sources

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining gaps from the mass-apply design. Add Playwright submit adapters for Lever, Ashby, and Workable so the top four ATSs all submit deterministically. Add a Claude browser-agent submit fallback so any unknown ATS can still complete a B-mode application. Broaden ingestion with LinkedIn, Indeed, and Wellfound scrapers, plus an agentic discovery loop that proposes new companies and a dream-tier research pass that stores structured notes on the application. Finish KB ingestion by wiring Notion (official API) and a personal-website crawler.

**Architecture:** Submit adapters drop into `submit_adapters/` behind the same `(ctx, on_progress) -> SubmitResult` contract as `submit_adapters/greenhouse.py`; the runner picks an adapter by `posting.source`, falls back to `agent_submit.py` if no adapter matches or the adapter raises `AdapterUnsupported`. The agent submitter wraps `claude-agent-sdk` (re-using the `app.services.agent` patterns) with a Playwright tool surface (`navigate`, `snapshot`, `click`, `fill`, `upload`, `submit`) and is restricted to **B-mode only** in this slice — the user always confirms the final submit. New scraping sources implement the existing `Source` protocol (`api/app/services/sources/protocol.py`); they ship without a feature flag (user accepted ToS risk) but are tagged `tos_risk="high"` in the registry so the UI can surface a badge. Agentic discovery and dream-tier research are new `agents/` modules that write to existing tables (`companies` for discovery, a new `application_research` table for the dream brief). KB sync extends `kb_sources/` (parallel to `sources/`) with `notion.py` and `website.py`.

**Tech Stack:** Existing FastAPI + async SQLAlchemy + Postgres job queue + claude-agent-sdk + Playwright (already in image from Slice 2). New: `notion-client` (official SDK), `httpx` + `selectolax` for the website crawler (already vendored in Slice 4), `playwright` reused for the three scrapers and the browser-agent.

**Reference docs (read before starting):**
- `docs/plans/2026-04-26-mass-apply-design.md` — parent design (slice 5 is the last bullet under "Build sequencing"; identity-honesty + no-double-apply invariants apply to every new submit path).
- `docs/plans/2026-04-27-mass-apply-slice-4-sources.md` — slice 4 plan (source registry pattern; URL-paste route; companies CRUD).
- `docs/plans/2026-04-26-mass-apply-slice-2-greenhouse-apply.md` — slice 2 plan (Greenhouse submit adapter — the template for tasks 1–3).
- `api/app/services/sources/__init__.py` — current `SOURCES` registry; new scrapers register here.
- `api/app/services/submit_adapters/__init__.py` — current adapter package; new adapters export from here.
- `api/app/services/submit_adapters/greenhouse.py` — the working Playwright adapter to mirror.
- `api/app/services/agent.py` — existing claude-agent-sdk wrapper; the browser-agent extends the same pattern (system-prompt builder, `query_json`, strict envelope, AgentError).

**Scope guardrails:**
- Browser-agent is **B-mode only** in this slice. No autonomous A-mode submission via the agent — user must confirm the final submit step. A-mode promotion for the agent is a future slice once we have telemetry from B-mode runs.
- LinkedIn / Indeed / Wellfound scrapers are NOT feature-flagged off (user-approved). They are tagged `tos_risk="high"` so the UI can render a warning chip.
- Agentic discovery proposes companies and writes them to `companies` with `enabled=false`. The user reviews and toggles them on. No auto-enabling.
- Dream-tier research runs only for postings classified `tier="dream"` (Slice 3 added the column). Output stored on the `application_research` row; consumed by the tailor prompt in a follow-up slice — this slice only persists it.
- Notion sync is scoped (the user supplies a list of page/database IDs in `kb_sources` config), not whole-vault.
- Personal-website crawler honours `robots.txt` and an allow/deny path list (per the design).
- No new UI surfaces beyond a research-notes panel in the application drawer and tos-risk badges in the inbox source filter. No discovery review wizard — the existing Companies page (Slice 4 task 12) already supports enabling/disabling rows.

**Tests run inside Docker compose**: `docker compose run --rm api pytest`. Frontend: `cd web && npx vitest run`.

---

## Task 1: Lever submit adapter

**Files:**
- Create: `api/app/services/submit_adapters/lever.py` — mirror `greenhouse.py` shape: same `submit(ctx, on_progress)` signature, same `CaptchaPauseRequired` raising on bot-check pages, same confirmation-detection step (Lever shows a "Thank you for applying" panel with a stable `data-qa` selector).
- Modify: `api/app/services/submit_adapters/__init__.py` — export `lever` adapter.
- Modify: `api/app/services/submit_adapters/registry.py` (introduced here if missing — a single `ADAPTERS: dict[str, SubmitAdapter]` keyed by `source`) so the runner picks adapters by `posting.source`.
- Test: `api/tests/test_lever_submit_adapter.py` — Playwright mock with a captured Lever apply page fixture under `api/tests/fixtures/lever_apply.html`; assert form fills, resume uploads, captcha-pause raises on the synthetic captcha fixture.

**Step 5: Commit** `feat(api): lever playwright submit adapter`

---

## Task 2: Ashby submit adapter

**Files:**
- Create: `api/app/services/submit_adapters/ashby.py` — Ashby renders apply forms client-side; adapter waits on `[data-testid="application-form"]`, fills using stable test ids, uploads via the file input next to the "Resume" label.
- Modify: `api/app/services/submit_adapters/__init__.py` — export.
- Modify: `api/app/services/submit_adapters/registry.py` — register.
- Test: `api/tests/test_ashby_submit_adapter.py` with `api/tests/fixtures/ashby_apply.html`.

**Step 5: Commit** `feat(api): ashby playwright submit adapter`

---

## Task 3: Workable submit adapter

**Files:**
- Create: `api/app/services/submit_adapters/workable.py` — Workable's `apply.workable.com` flow has two steps (resume upload + parsed-form review). Adapter handles both, asserts the parsed form's name field matches the profile's name, then completes.
- Modify: `api/app/services/submit_adapters/__init__.py` — export.
- Modify: `api/app/services/submit_adapters/registry.py` — register.
- Test: `api/tests/test_workable_submit_adapter.py` with `api/tests/fixtures/workable_apply.html`.

**Step 5: Commit** `feat(api): workable playwright submit adapter`

---

## Task 4: Submit runner dispatches by source + falls back

**Files:**
- Modify: `api/app/services/jobs_runner.py::run_submit_application_job` — replace the hardcoded greenhouse import with `ADAPTERS.get(posting.source)`. If `None`, or if the adapter raises `AdapterUnsupported`, dispatch to the new `agent_submit.run(ctx, on_progress)` (Task 5). Force `mode="B"` whenever the agent path is taken — refuse to run agent submission in A-mode and surface a `needs_attention` row instead.
- Modify: `api/app/services/submit_adapters/protocol.py` (create if missing) — add `class AdapterUnsupported(RuntimeError)`.
- Test: extend `api/tests/test_submit_runner.py` — three cases: (a) lever posting routes to lever adapter; (b) unknown-source posting routes to agent in B-mode; (c) unknown-source posting in A-mode parks in `needs_attention` and does NOT invoke the agent.

**Step 5: Commit** `refactor(api): submit runner dispatches by source with agent fallback`

---

## Task 5: Browser-agent submit fallback (B-mode only)

**Files:**
- Create: `api/app/services/submit_adapters/agent_submit.py` — claude-agent-sdk session built like `app.services.agent`. System prompt carries the identity-honesty invariant, the profile JSON, the tailored resume PDF path, the JD, and the rule "you MUST stop before clicking final submit and emit `{action: \"awaiting_user_confirmation\", screenshot_path, form_summary}`". Tools: thin wrappers over `mcp__playwright` style ops (`navigate`, `snapshot`, `click(selector)`, `fill(selector, value)`, `upload(selector, path)`, `screenshot()`). Each tool call is logged to `application_events` (already present from Slice 2).
- Create: `api/app/services/submit_adapters/agent_tools.py` — Playwright tool implementations the SDK calls; one Playwright `BrowserContext` per submission, hard timeout 5 min, hard cap 40 tool calls.
- Modify: `api/app/db/models.py` — add `applications.agent_session_id: str | None`, `applications.awaiting_user_confirmation: bool` (default false). Migration `0013_agent_submit_fields.py`.
- Test: `api/tests/test_agent_submit.py` — mock `claude_agent_sdk.query` to return a fixed tool-call sequence ending in `awaiting_user_confirmation`; assert events written, application row marked awaiting, no final-submit tool ever called.

**Step 5: Commit** `feat(api): browser-agent submit fallback (b-mode only)`

---

## Task 6: Review-queue surfaces awaiting-confirmation agent runs

**Files:**
- Modify: `api/app/routes/applications.py` — `POST /applications/{id}/confirm_submit` endpoint. Body: `{confirm: true}`. Validates `awaiting_user_confirmation=true`, re-opens the persisted Playwright session via `agent_session_id`, clicks final submit, records confirmation artifacts, clears the flag.
- Modify: `web/src/routes/Review.tsx` — render an "Agent paused — review and confirm" card for rows with `awaiting_user_confirmation=true`, including the last screenshot and form summary.
- Modify: `web/src/api.ts` — add `confirmAgentSubmit(id)`.
- Test: `api/tests/test_applications_confirm_submit.py`; `web/src/routes/Review.test.tsx` extended.

**Step 5: Commit** `feat(api+web): confirm agent-submitted application from review queue`

---

## Task 7: LinkedIn source adapter (scrape)

**Files:**
- Create: `api/app/services/sources/linkedin.py` — implements `Source` protocol. `fetch_company_postings(slug)` drives Playwright through `linkedin.com/company/{slug}/jobs/`, scrolls to load all postings, harvests cards. `fetch_one_url(url)` parses `/jobs/view/{id}`. `tos_risk = "high"` attribute on the source instance.
- Modify: `api/app/services/sources/__init__.py` — register; extend `SOURCES` typing or registration helper to record `tos_risk`.
- Modify: `api/app/services/sources/protocol.py` — add optional `tos_risk: Literal["clean", "high"] = "clean"` attribute on `Source`.
- Test: `api/tests/test_linkedin_fetch.py` — fixture `api/tests/fixtures/linkedin_company_jobs.html`, mock Playwright via injected `page_factory`.

**Step 5: Commit** `feat(api): linkedin source adapter (playwright scrape)`

---

## Task 8: Indeed source adapter (scrape)

**Files:**
- Create: `api/app/services/sources/indeed.py` — Playwright through `indeed.com/cmp/{slug}/jobs`; per-posting `viewjob?jk=...` parser. `tos_risk="high"`.
- Modify: `api/app/services/sources/__init__.py` — register.
- Test: `api/tests/test_indeed_fetch.py` with `indeed_company_jobs.html` fixture.

**Step 5: Commit** `feat(api): indeed source adapter (playwright scrape)`

---

## Task 9: Wellfound source adapter (scrape)

**Files:**
- Create: `api/app/services/sources/wellfound.py` — Playwright through `wellfound.com/company/{slug}/jobs`. `tos_risk="high"`.
- Modify: `api/app/services/sources/__init__.py` — register.
- Test: `api/tests/test_wellfound_fetch.py` with `wellfound_company_jobs.html` fixture.

**Step 5: Commit** `feat(api): wellfound source adapter (playwright scrape)`

---

## Task 10: Inbox tos-risk badge + source filter chips

**Files:**
- Modify: `api/app/routes/sources.py` (new — small `GET /sources` returning `[{name, tos_risk}]`) so the UI can label sources without hardcoding the list.
- Modify: `web/src/routes/Inbox.tsx` — extend the source filter chip group (Slice 4 task 14) to include linkedin/indeed/wellfound, render a small "ToS risk" badge next to chips with `tos_risk="high"`.
- Test: `api/tests/test_sources_route.py`; extend `web/src/routes/Inbox.test.tsx`.

**Step 5: Commit** `feat(api+web): expose source tos risk + badge in inbox`

---

## Task 11: Agentic company discovery

**Files:**
- Create: `api/app/services/agents/discover_companies.py` — claude-agent-sdk session (Sonnet) with a web-search tool. Inputs: full `profile` row + tier preferences + the current `companies` list (so it doesn't re-propose). Output envelope: `{proposals: [{source, slug, display_name, rationale}]}`. Validates each proposal's slug actually returns postings via `SOURCES[source].fetch_company_postings(slug)` before insert.
- Create: `api/app/services/jobs_runner.py::run_discover_companies_job` — invoke discovery, insert accepted proposals into `companies` with `enabled=false` and `discovered_by="agent"`.
- Modify: `api/app/db/models.py` — add `companies.discovered_by: str | None` and `companies.discovery_rationale: str | None`. Migration `0014_companies_discovery.py`.
- Modify: `api/app/worker.py::_scheduler` — enqueue one `discover_companies` job daily at 03:00 if none in flight.
- Modify: `web/src/routes/Companies.tsx` — show a "Proposed" filter that lists rows with `discovered_by="agent"` and shows the rationale tooltip; existing enable toggle promotes them.
- Test: `api/tests/test_discover_companies.py` (mock SDK + `SOURCES`); extend `web/src/routes/Companies.test.tsx`.

**Step 5: Commit** `feat(api+web): agentic company discovery`

---

## Task 12: Dream-tier research

**Files:**
- Create: `api/app/db/models.py` — `application_research` table: `application_id` (FK, unique), `brief_md` text, `signals_json` jsonb, `generated_at`, `model`. Migration `0015_application_research.py`.
- Create: `api/app/services/agents/dream_research.py` — Sonnet (Opus only on opt-in flag) with web search. Inputs: `posting`, `company`, profile. Output: `{brief_md, signals: {recent_news: [...], hiring_signals: [...], people: [...]}}`. Cached per company for 30 days (per design).
- Modify: `api/app/services/jobs_runner.py` — register `run_dream_research_job`. After classify writes `tier="dream"`, enqueue a research job; persist result onto `application_research`.
- Modify: `api/app/routes/applications.py` — include `research` in `ApplicationOut` when present.
- Modify: `web/src/routes/Application.tsx` (or the existing application drawer) — render research notes in a collapsible "Company brief" panel.
- Test: `api/tests/test_dream_research.py` (mock SDK); extend application route + UI tests.

**Step 5: Commit** `feat(api+web): dream-tier research notes on application`

---

## Task 13: Notion KB source

**Files:**
- Create: `api/app/services/kb_sources/notion.py` — uses `notion-client` with `NOTION_TOKEN` env. Config rows in existing `kb_sources` table (added in Slice 1) hold the page/database IDs. `sync()` walks each scoped root, fetches blocks, renders to markdown, upserts into `kb_documents` keyed by `(source="notion", external_id=page_id)`. Embeddings run via the existing pipeline.
- Modify: `api/app/services/jobs_runner.py` — register `run_kb_sync_notion`.
- Modify: `api/app/worker.py::_scheduler` — every 6h enqueue `kb_sync_notion` if `NOTION_TOKEN` set and there is at least one notion `kb_sources` row.
- Modify: `web/src/routes/KB.tsx` — add "Notion" config form (token status read-only, add/remove page IDs).
- Test: `api/tests/test_kb_notion_sync.py` (mock `notion-client`).

**Step 5: Commit** `feat(api+web): notion kb sync`

---

## Task 14: Personal-website KB source

**Files:**
- Create: `api/app/services/kb_sources/website.py` — async crawler using `httpx` + `selectolax`. Config row carries `root_url`, `allow_patterns`, `deny_patterns`. Honours `robots.txt` (cached per host). Renders each page to markdown, upserts into `kb_documents` keyed by `(source="website", external_id=url)`. Re-crawl drops pages no longer reachable.
- Modify: `api/app/services/jobs_runner.py` — register `run_kb_sync_website`.
- Modify: `api/app/worker.py::_scheduler` — nightly `kb_sync_website` per configured root.
- Modify: `web/src/routes/KB.tsx` — add "Website" config form (root URL, allow/deny patterns).
- Test: `api/tests/test_kb_website_sync.py` (mock `httpx` + a robots.txt fixture; assert deny pattern excludes a page; assert removed page is purged).

**Step 5: Commit** `feat(api+web): personal-website kb sync`

---

## Task 15: E2E smoke (LIVE_E2E gated)

**Files:**
- Create: `web/e2e/agent_and_breadth.spec.ts`

Flow:
1. Log in.
2. Add a Lever company; trigger scheduler; let posting flow through classify → tailor; submit via Lever adapter (mocked Playwright); assert `applications` row recorded with adapter=`lever`.
3. Add an `unknown-ats` posting via URL paste (mocked source returning `tos_risk="clean"`, no matching adapter); assert pipeline runs, lands in review queue with `awaiting_user_confirmation=true`; click confirm; assert application recorded with adapter=`agent`.
4. Trigger `discover_companies` job (mocked SDK); assert at least one row appears in Companies with `discovered_by="agent"` and `enabled=false`.
5. Force a posting to `tier="dream"`; assert `application_research` row persists and the brief renders in the application drawer.
6. (If `LIVE_NOTION_TOKEN` env set) trigger a `kb_sync_notion` job; assert ≥0 documents ingested.

**Step 5: Commit** `test(e2e): agent fallback + scrapers + discovery + research smoke`

---

## Done criteria for Slice 5

- All four top ATSs (Greenhouse, Lever, Ashby, Workable) submit deterministically via Playwright adapters; the runner picks the adapter from `posting.source`.
- Any posting from a source with no matching adapter falls back to the browser-agent submitter in B-mode; the user confirms the final submit from the review queue.
- LinkedIn, Indeed, and Wellfound postings flow through the inbox alongside ATS postings, tagged with a visible `tos_risk="high"` badge.
- The agent proposes new companies daily; proposals appear in the Companies admin under a "Proposed" filter and require the user to enable them before they're polled.
- Dream-tier postings get a persisted research brief on the application, visible in the application drawer.
- Notion (scoped pages/databases) and personal-website (allow/deny + robots.txt) feed the KB on cron; embeddings reuse the existing pipeline.
- The one-page resume invariant, identity-honesty invariant, and the no-double-apply canonical-key gate are unchanged — every new submit path still goes through the existing pre-submit gate added in Slice 2.

## Open items deferred (do not address in Slice 5)

- A-mode for the browser-agent submitter (needs B-mode telemetry first).
- GitHub-curated source (`SimplifyJobs/New-Grad-Positions`) — design mentions it but it's straightforward to add later under the same `Source` protocol.
- Generic IMAP (non-Gmail) — out of scope until needed.
- Captcha-solving services — explicitly out per design.
- Wide-net / spray tier policy.
- Recruiter-mail ingestion, status pipeline, follow-up automation.
