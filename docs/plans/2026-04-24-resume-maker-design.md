# HireScript — Phase 1: AI-First LaTeX Resume Maker

**Date:** 2026-04-24
**Status:** Design approved, ready for implementation planning
**Scope:** Phase 1 only. Phase 2 (mass job application) is out of scope but informs data model choices.

## Goal

A single-tenant web app for the primary user to maintain a master LaTeX resume and rapidly generate job-tailored variants using Claude. Manual LaTeX editing is supported but secondary; AI is the primary interface.

## Non-goals (Phase 1)

- Multi-tenant auth, billing, teams
- Automated job-board scraping or submission
- Mobile-native app
- Exotic LaTeX template support beyond the curated set
- Preserving original styling of uploaded PDF resumes

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite + TypeScript | Fast dev loop, mature ecosystem |
| Backend | FastAPI (Python) | Strong PDF/LaTeX library ecosystem |
| LLM | `claude-agent-sdk` (Python) via local Claude CLI | Uses Claude Max subscription, no API costs |
| LaTeX compile | Tectonic (single binary) | Small image, handles 95% of resume templates |
| PDF → structured content | Marker (OSS) | Higher fidelity than raw text extraction |
| LaTeX editor | CodeMirror 6 | Syntax highlighting, proven |
| PDF preview | PDF.js / react-pdf | Standard |
| DB | PostgreSQL (JSONB + text) | Structured resume content + raw LaTeX |
| Object storage | MinIO (local) / S3 (prod) | Compiled PDFs |
| Auth | Single-password + signed session cookie | Single-tenant, minimal code |
| Deploy | Docker Compose on small VPS, Caddy for HTTPS | Simple, cheap |

Deployment note: the VPS must have Node + `claude` CLI installed, with `claude login` run once so the Agent SDK can use the Max subscription.

## The One-Page Constraint (non-negotiable)

Every resume this system produces — master or variant, AI-generated or human-edited — must fit on exactly one page. This is not a post-hoc check or a UI warning; it is a hard architectural invariant that shapes the compile loop, the AI integration, and the data model.

**Principles:**

1. **Never truncate to fit.** We never clip, overflow-hide, or silently drop content to force one page. If the document is too long, it must be *intelligently rewritten* — tighter phrasing, combined bullets, dropped low-signal items — not cut off.
2. **ATS action verbs are protected.** Rewrites must preserve action verbs and measurable outcomes that matter to ATS keyword matching (e.g., *led, architected, shipped, reduced, migrated, owned, automated, scaled, implemented, designed, negotiated, drove, launched, optimized, integrated*, plus any verbs/keywords present in the target JD). A protected-terms list is passed into every AI edit prompt. Rewriting a bullet to remove a protected verb is a rule violation the agent must correct.
3. **Page count is a first-class compile output.** Every Tectonic compile returns `(pdf_bytes, page_count)`. Anything producing `page_count != 1` is a compile-level failure for AI flows, surfaced the same way a LaTeX syntax error would be.
4. **The overflow-repair loop is real-time.** When an AI edit produces >1 page, the agent is immediately re-invoked with the compiled page count, the overflowing content, and the protected-terms list, and told to tighten without dropping protected terms. This loop runs up to N iterations (start with 4) before surfacing failure to the user.
5. **Manual editing is advisory, not auto-mutating.** When a human edits LaTeX directly and the result overflows, we show a blocking "Resume is 2 pages — fix before saving as final" banner with a one-click "Ask Claude to tighten" action. We never rewrite a human's LaTeX behind their back.
6. **Underflow is fine.** A half-page resume is unusual but not invalid; the constraint is `page_count == 1`, not "fills the page."

**Where this lives in the stack:**

- `compile_latex()` returns `CompileResult(pdf: bytes, page_count: int)` — page count derived from Tectonic's output PDF via a lightweight PDF parse (pypdf). Single source of truth.
- A `OnePageEnforcer` service wraps every AI-driven edit: it takes a candidate LaTeX, compiles it, and if `page_count != 1` re-invokes Claude with a structured `OverflowContext` (current page count, estimated overflow lines, protected terms, last-attempt diff) until it converges or exhausts the iteration budget.
- The Agent SDK system prompt for *all* editing flows includes: the one-page rule, the protected-terms policy, the current page count of the document being edited, and an instruction that any proposed edit must be self-consistent with the one-page constraint.
- Protected terms = a base list (common strong action verbs) ∪ verbs/nouns extracted from the target JD (for variants) ∪ any terms the user has pinned on the master resume.
- Diffs shown to the user include a **page count badge** (✓ 1 page / ✗ 2 pages). A diff that fails the one-page rule cannot be accepted via the normal "accept" button — it requires an explicit override.

**Data model additions:**

- `resume_versions.page_count` (int) — stored alongside the compiled PDF.
- `resumes.protected_terms` (jsonb, array of strings) — user-pinned terms layered on top of the base list and JD-derived terms.

## Realtime & Token Economics

"Realtime" here means: the user sees the page-count verdict and the proposed edit as it streams, not after a 30-second round-trip. The repair loop must therefore be cheap enough to run 1–4 times without blowing context or latency budgets. This drives model choice, prompt shape, and what we send on each hop.

**Model routing (cheap by default, escalate on evidence):**

| Job | Default model | Escalate to | Trigger to escalate |
|---|---|---|---|
| Free-form chat edits | Haiku 4.5 | Sonnet 4.6 | Haiku's diff fails to compile OR fails one-page check twice in a row |
| Overflow-repair loop (iterations 1–2) | Haiku 4.5 | — | Mechanical tightening; Haiku handles it |
| Overflow-repair loop (iteration 3+) | Sonnet 4.6 | — | Haiku couldn't converge; needs better judgment |
| Tailor to JD (default) | Sonnet 4.6 | Opus 4.7 | User ticks "Deep tailor" |
| PDF-to-template mapping (onboarding) | Sonnet 4.6 | — | One-shot, not hot-path |
| JD keyword extraction (protected terms) | Haiku 4.5 | — | Pure extraction, runs once per JD |

Haiku is the workhorse. Opus is opt-in and rare. Sonnet is the middle of the escalation ladder, not the default.

**Prompt-shape rules (enforced in the agent wrapper, not left to prompt authors):**

1. **Never resend the full resume on repair hops.** The repair loop sends only the overflowing diff + the minimal structured `OverflowContext` (current page count, estimated overflow lines, protected-terms list, last edit). The base resume LaTeX is cached.
2. **Prompt caching is on for every call.** System prompt, protected-terms list, template skeleton, and master resume LaTeX all live in cached prefixes (`cache_control: ephemeral`). Only the user instruction and the live diff are non-cached. Target: ≥90% cached tokens on repair hops.
3. **Streaming, not batch.** All edit calls use `stream=True`. The diff is surfaced to the UI token-by-token; the compile+page-count check fires the moment the LaTeX block closes. No waiting for the full response before starting the Tectonic compile.
4. **Unified diffs on the wire, not full files.** The agent emits and consumes unified diffs for edits. Saves input and output tokens on every hop.
5. **Structured output for the repair loop.** The repair prompt returns a strict JSON envelope (`{ "diff": "...", "removed_terms": [...], "rationale": "..." }`) so the wrapper can validate protected-term preservation *without* an extra LLM call.
6. **Hard budgets.** Per-edit budget: ≤8k output tokens, ≤30s wall clock across all repair iterations combined. If we blow the budget, surface the best attempt with a "budget exceeded — try again or edit manually" banner. Budgets are config, not hardcoded.
7. **Short-circuit the obvious.** Before calling any model: if the current document already compiles to 1 page and the user's instruction is "tighten", run a cheap heuristic pass (collapse double spaces, tighten known verbose patterns) and show *that* as the proposed diff. Model only runs if the heuristic didn't materially change anything.

**What we measure (logged per edit):** model used, input tokens (cached vs fresh), output tokens, repair iterations, wall-clock time, final page count. This is how we validate the routing table above is actually cheap and escalate thresholds are right — not by guessing.

## Core User Flows

### 1. Onboard a resume (first use)

User provides an existing resume via one of three paths:

- **Upload PDF** → backend runs Marker → structured markdown → Claude maps content into a chosen curated LaTeX template → saved as master.
- **Upload `.tex` file** → parsed into structured sections (against known template shapes) → saved as master.
- **Paste LaTeX** → same parse path as `.tex` upload.

User picks from ~3 curated templates (Jake's Resume, Awesome-CV, RenderCV) before content mapping. No attempt to preserve the original visual layout.

### 2. Edit with AI

Two entry points, both produce a diff the user accepts or rejects:

- **Chat sidebar** — open-ended instructions ("tighten the Acme bullets", "add metrics throughout"). Each turn produces a proposed LaTeX diff + re-rendered PDF preview.
- **"Tailor to Job Description" preset** — hero action. User pastes JD (title, company, URL, text). Claude produces a new variant resume tailored to the JD. Variant is linked to both the master resume and the stored JD.

Model default: Haiku 4.5 for chat edits, Sonnet 4.6 for "Tailor to JD". Escalation rules live in the "Realtime & Token Economics" section above. Opus 4.7 is only used when the user explicitly ticks "Deep tailor".

Non-negotiable: every AI change is surfaced as a visible diff (old vs new LaTeX, with re-rendered PDF) before it's applied.

### 3. Manual edit

Hybrid editor, default view is form-based:

- **Section form editor** (default) — resume parsed into structured sections (Experience, Education, Skills, Projects, etc.). Each section has form fields. Novices never see LaTeX.
- **"Show raw LaTeX" toggle** — drops the section into a CodeMirror 6 panel with two-way sync. Power users can edit directly.

Two-way sync is tractable because we control the templates: each template has a known structure the parser targets.

### 4. Manage saved resumes

- **Master resume**: one per user (Phase 1).
- **Variants**: created by "Tailor to JD" or by manual fork. Each variant links to the master and (optionally) a JD.
- **Linear edit history per variant**: every AI or manual edit creates a new version; user can roll back. No branching.
- **List view**: master at top, variants grouped under it with JD title/company visible.

## Data Model (sketch)

```
users                    (single row in Phase 1)
  id, password_hash

resumes
  id, user_id, parent_id (null for master), kind (master|variant),
  name, template_id, latex_source (text), content_json (jsonb),
  job_description_id (nullable), created_at, updated_at

resume_versions
  id, resume_id, latex_source, content_json, compiled_pdf_key,
  edit_source (ai|manual), edit_prompt (nullable), created_at

job_descriptions
  id, user_id, title, company, url, raw_text, parsed_json, created_at

templates
  id, name, latex_skeleton, section_schema_json
```

Compiled PDFs live in object storage, keyed by `resume_version.id`.

## AI Integration

All Claude calls go through the Python `claude-agent-sdk`. Three distinct prompts:

1. **PDF-to-template mapping** — input: Marker's structured markdown + chosen template's section schema. Output: filled template JSON → rendered to LaTeX.
2. **Free-form chat edit** — input: current LaTeX + user instruction. Output: unified diff, must re-compile cleanly.
3. **Tailor to JD** — input: master resume JSON + JD text + optional custom instructions. Output: new variant resume JSON → rendered to LaTeX.

Every generated LaTeX is compiled with Tectonic before being shown to the user. Two compile-level failure modes are handled identically via re-prompt loops:

- **LaTeX errors** → re-prompt with the Tectonic stderr (max 2 retries).
- **Page-count != 1** → re-prompt with `OverflowContext` (see "The One-Page Constraint"), including the protected-terms list and a directive to tighten without dropping protected terms (max 4 retries).

Only after both loops are exhausted is failure surfaced to the user.

All three prompts above receive the one-page rule and protected-terms list as part of the system prompt — not just the repair loop — so most first-pass generations already fit.

## Error Handling

- **Tectonic compile failure** after AI edit → auto-retry with error context (≤2 times), then show the user the raw diff with an error banner and let them fix manually or discard.
- **Page overflow (page_count > 1)** after AI edit → invoke the overflow-repair loop (≤4 iterations) with protected-terms context, then surface failure with the best attempt, the protected-terms list used, and a "try again with different guidance" affordance. Never silently truncate.
- **Page overflow on manual edit** → block the save-as-final action; show an inline "Ask Claude to tighten" button that hands the LaTeX to the repair loop.
- **Marker extraction failure / garbage output** on PDF upload → fall back to raw text extraction + warn the user that fidelity may be low.
- **Claude CLI not authenticated** on server → health check at startup, surface a clear admin error.
- **Invalid LaTeX on user paste** → parse best-effort; if section parsing fails, load into raw-LaTeX-only mode for that resume.

## Testing Approach

- **Backend**: pytest for parsers (LaTeX → JSON and back), Tectonic compile integration test on each curated template, mock the Agent SDK for unit tests and hit it live in a small smoke-test suite.
- **Frontend**: Vitest for components, Playwright for the two critical flows (onboard → compile → preview, and tailor-to-JD → accept diff).
- **Golden tests** for each curated template: known JSON content → known LaTeX output → compiles without error.

## Phase 2 Hooks (not built now)

Decisions made here that enable Phase 2 without rework:
- JDs stored as first-class entities (ready to be populated by a scraper).
- Variant resumes link to JDs (ready for "which resume did I send where" tracking).
- `user_id` column exists everywhere (ready for multi-tenant migration).
- Single-password auth can be swapped for Auth.js / Clerk without schema changes.

## Open Questions (defer to implementation)

- Exact curated template list (start with Jake's Resume; add 2 more after first working slice).
- Whether to expose a "compile locally in browser" option later (SwiftLaTeX WASM) — skip for now.
- Diff UI: side-by-side LaTeX vs inline-rendered PDF diff — pick during implementation.
