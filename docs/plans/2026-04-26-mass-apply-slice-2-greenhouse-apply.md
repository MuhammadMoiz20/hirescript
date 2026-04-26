# Mass-Apply Slice 2 — Greenhouse Ingest + B-Mode Apply

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make HireScript apply to one Greenhouse job posting end-to-end in human-in-loop (B) mode — ingest postings nightly, prepare a tailored resume + cover letter per posting, queue them for one-click submission via a Greenhouse Playwright adapter.

**Architecture:** Two new domain tables (`job_postings`, `applications`) plus supporting tables (`companies`, `answer_cache`). The existing `worker` service (Postgres-queue, FOR UPDATE SKIP LOCKED, heartbeat) is reused — Slice 2 adds new `kind` values to the runner dispatch (`ingest_greenhouse`, `classify_posting`, `prepare_application`, `submit_application`) and a second asyncio task to `worker.main()` that periodically enqueues `ingest_greenhouse` jobs. Slice 1's KB retrieval is threaded into a new tailor wrapper. Mode is locked to B — autonomous A-mode arrives in Slice 3. Naming: the existing `Job` model means "async work unit" and is unchanged; Slice 2 introduces `JobPosting` and `Application`.

**Tech Stack:** FastAPI, async SQLAlchemy 2.x, Alembic, Pydantic v2, httpx (Greenhouse JSON API), Playwright (browser submit), existing worker + job queue + Anthropic Agent SDK + Voyage embeddings.

**Reference docs (read before starting):**
- `docs/plans/2026-04-26-mass-apply-design.md` — parent design (now reflects no-double-apply invariant + github_curated source).
- `docs/plans/2026-04-26-mass-apply-slice-1-profile-kb.md` — slice 1 plan, completed.
- `docs/plans/2026-04-25-background-jobs-design.md` — pre-existing design for the worker + job queue this slice rides on.
- `api/app/worker.py`, `api/app/services/jobs_runner.py`, `api/app/services/jobs_repo.py` — actual existing worker code; mirror its style for new `kind` runners.
- `api/app/services/tailor.py` — the existing tailor entry point to wrap.
- `api/app/services/kb_ingest.py::retrieve` — slice 1's KB retrieval; called by the tailor wrapper.

**Scope guardrails:**
- B-mode only. No autonomous submit. The pre-submit gate from the design doc still runs at submit time.
- One source (Greenhouse) and one ATS adapter (Greenhouse). Lever / Ashby / Workable arrive in Slice 4.
- Hardcoded ~5-10 company allowlist in code (`services/sources/greenhouse_companies.py`). UI for managing the list arrives in Slice 4.
- No browser-agent fallback (Slice 5). If the Greenhouse Playwright adapter fails, the submit job fails and surfaces in the existing Jobs page; the user investigates manually.
- No tier classification UI yet — Slice 2 still computes a fit score (Haiku) so we don't have to replumb later, but the policy effect is "tag, don't gate."
- No notification channel — failures appear in the Jobs page. Push notifications arrive in Slice 3.

**Tests run inside Docker compose**: `docker compose run --rm api pytest`. Frontend: `cd web && npx vitest run`.

---

## Task 1: New tables — `companies`, `job_postings`, `applications`, `answer_cache`

**Files:**
- Create: `api/alembic/versions/0009_postings_applications.py`
- Test: extend `api/tests/test_migrations.py`

**Schema:**

`companies`:
- `id` int PK
- `slug` text not null unique (Greenhouse board slug — e.g. `"anthropic"`)
- `display_name` text not null
- `source` text not null default `"greenhouse"` (future: lever/ashby/workable)
- `enabled` bool not null default true
- `created_at` timestamptz default now()

`job_postings`:
- `id` int PK
- `user_id` int FK `users.id` not null
- `source` text not null (`"greenhouse"`)
- `source_job_id` text not null (Greenhouse job id as string)
- `company_id` int FK `companies.id`
- `title` text not null
- `location` text
- `apply_url` text not null
- `description_html` text
- `description_text` text not null (stripped, used by classify + tailor)
- `meta` jsonb not null default `'{}'::jsonb`
- `tier` text — `"dream" | "targeted" | "wide_net" | "skip" | null`
- `fit_score` int — 0..100 nullable
- `classification_rationale` text
- `status` text not null default `"new"` — `"new" | "classified" | "preparing" | "ready" | "submitted" | "duplicate_skipped" | "errored"`
- `canonical_key` text — the `(canonical_company:canonical_role_or_url)` string for dedup (computed when prepared)
- `ingested_at` timestamptz default now()
- Unique: `(user_id, source, source_job_id)`
- Index: `(user_id, status, ingested_at desc)` for the inbox query.

`applications`:
- `id` int PK
- `user_id` int FK `users.id` not null
- `posting_id` int FK `job_postings.id` not null
- `mode` text not null default `"B"` (B-only this slice; future: A | B)
- `status` text not null — `"prepared" | "submitting" | "submitted" | "errored" | "duplicate_skipped"`
- `resume_variant_id` int FK `resumes.id` (the tailored resume snapshot)
- `cover_letter_text` text
- `form_payload` jsonb (the read-only summary surfaced in the review queue)
- `confirmation_html` text — captured at submit time
- `confirmation_screenshot_path` text — local volume path
- `canonical_key` text not null (the `(user_id, canonical_company, canonical_role_or_url)` value)
- `error` text
- `prepared_at` timestamptz default now()
- `submitted_at` timestamptz
- **Unique: `(user_id, canonical_key)`** — the no-double-apply DB invariant.
- Index: `(user_id, status, prepared_at desc)` for the review queue.

`answer_cache`:
- `id` int PK
- `user_id` int FK
- `question_hash` text not null (sha256 of normalized question text)
- `question_text` text not null
- `answer_text` text not null
- `last_used_at` timestamptz default now()
- Unique: `(user_id, question_hash)`

**Tests** (extend existing `test_migrations.py`):

```python
@pytest.mark.asyncio
async def test_slice2_tables_exist():
    async with engine.connect() as conn:
        for t in ("companies", "job_postings", "applications", "answer_cache"):
            assert (await conn.execute(text(f"SELECT to_regclass('{t}')"))).scalar() == t

@pytest.mark.asyncio
async def test_applications_canonical_key_unique():
    async with engine.connect() as conn:
        rows = (await conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE tablename='applications'"
        ))).all()
        assert any("canonical_key" in r[0] for r in rows)
```

**Step 5: Commit** `feat(api): job_postings/applications/companies/answer_cache tables`

---

## Task 2: SQLAlchemy models + Pydantic schemas

**Files:**
- Modify: `api/app/models.py` (append `Company`, `JobPosting`, `Application`, `AnswerCache`)
- Create: `api/app/schemas/posting.py` (Pydantic)
- Create: `api/app/schemas/application.py`
- Test: `api/tests/test_posting_schemas.py`

**Models:** Same `Mapped[…]` style as existing models. `JSONB().with_variant(JSON(), "sqlite")` for jsonb columns. `String(N)` lengths for short text.

**Pydantic shapes:**

```python
# api/app/schemas/posting.py
class JobPostingOut(BaseModel):
    id: int
    source: str
    source_job_id: str
    company: str  # display_name
    title: str
    location: str | None
    apply_url: str
    tier: str | None
    fit_score: int | None
    status: str
    ingested_at: datetime
```

```python
# api/app/schemas/application.py
class ApplicationOut(BaseModel):
    id: int
    posting_id: int
    posting: JobPostingOut
    status: str
    mode: Literal["A", "B"]
    cover_letter_text: str | None
    form_payload: dict | None
    submitted_at: datetime | None
    error: str | None
```

**Step 5: Commit** `feat(api): posting + application models and schemas`

---

## Task 3: Refactor `jobs_runner` to a dispatch table

**Files:**
- Modify: `api/app/services/jobs_runner.py` — introduce `RUNNERS: dict[str, Callable]` mapping kind → async runner.
- Modify: `api/app/worker.py` — replace the hardcoded `if job.kind == "tailor"` with `RUNNERS.get(job.kind)`.
- Test: extend `api/tests/test_worker.py` with a new test that registers a fake kind and asserts the worker dispatches it.

This is a 30-line refactor, fully backwards compatible. New runners in subsequent tasks just register themselves in `RUNNERS`.

```python
# api/app/services/jobs_runner.py
RUNNERS: dict[str, Callable[[SessionFactory, uuid.UUID], Awaitable[None]]] = {
    "tailor": run_tailor_job,
}
```

```python
# api/app/worker.py — _dispatch
runner = RUNNERS.get(job.kind)
if runner is None:
    log.warning("unknown job kind: %s", job.kind)
else:
    await runner(sf, job.id)
```

**Step 5: Commit** `refactor(api): job runner dispatch table for new kinds`

---

## Task 4: Greenhouse company allowlist

**Files:**
- Create: `api/app/services/sources/greenhouse_companies.py` — a constant list with `(slug, display_name)` tuples.
- Test: `api/tests/test_greenhouse_companies.py` — sanity-check the list shape.

```python
# api/app/services/sources/greenhouse_companies.py
GREENHOUSE_COMPANIES: list[tuple[str, str]] = [
    ("anthropic", "Anthropic"),
    ("openai", "OpenAI"),
    ("stripe", "Stripe"),
    ("vercel", "Vercel"),
    ("linear", "Linear"),
    ("airbnb", "Airbnb"),
    ("databricks", "Databricks"),
    ("ramp", "Ramp"),
]
```

(Verify each slug actually exists at `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs` before pinning — silent 404s waste tokens later.)

**Step 5: Commit** `feat(api): greenhouse company allowlist`

---

## Task 5: Greenhouse fetch + normalize

**Files:**
- Create: `api/app/services/sources/greenhouse.py`
- Test: `api/tests/test_greenhouse_fetch.py`

`async fetch_company_jobs(slug: str, *, http: httpx.AsyncClient) -> list[NormalizedPosting]`:
- GET `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`.
- Returns a list of `NormalizedPosting` TypedDicts: `{source_job_id, title, location, apply_url, description_html, description_text, meta}`.
- `description_text` strips HTML via `bs4` (already in repo? if not, add). Plain text used for classify + tailor.

`async upsert_postings(db, *, user_id, company_id, postings) -> dict[str, int]`:
- For each normalized posting, upsert into `job_postings` keyed by `(user_id, source, source_job_id)` via Postgres ON CONFLICT.
- Returns `{"created": N, "updated": M, "unchanged": K}`.

**Tests:** mock httpx, feed a fixture JSON shape (small Greenhouse response), assert normalization + upsert are correct. No real network.

**Step 5: Commit** `feat(api): greenhouse fetch + normalize`

---

## Task 6: `ingest_greenhouse` runner

**Files:**
- Modify: `api/app/services/jobs_runner.py` — add `async run_ingest_greenhouse_job(sf, job_id)` that reads payload `{company_slug}`, calls `greenhouse.fetch_company_jobs`, upserts postings, emits progress events. Register in `RUNNERS`.
- Modify: `api/app/services/jobs_repo.py` — add helper `enqueue_ingest_greenhouse(db, *, company_slug) -> uuid.UUID` (DRY for the scheduler).
- Test: `api/tests/test_ingest_greenhouse_runner.py`.

Heartbeat sidecar same as `run_tailor_job`. On error, `status="failed"` with structured error.

**Step 5: Commit** `feat(api): ingest_greenhouse job runner`

---

## Task 7: Periodic scheduler inside `worker.main()`

**Files:**
- Modify: `api/app/worker.py` — alongside the main claim loop, spawn a second asyncio task that runs every `INGEST_INTERVAL_SEC` (default 900 = 15 min). The task enqueues one `ingest_greenhouse` job per enabled company that doesn't already have a queued/running ingest for that slug.
- Test: extend `api/tests/test_worker.py` with `test_scheduler_enqueues_ingest_per_company` using a short interval and the existing `run_until_idle()` harness.

Implementation outline:

```python
async def _scheduler(sf: SessionFactory, shutdown: asyncio.Event):
    interval = int(os.getenv("INGEST_INTERVAL_SEC", "900"))
    while not shutdown.is_set():
        await _enqueue_due_ingests(sf)
        try:
            await asyncio.wait_for(shutdown.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass
```

`_enqueue_due_ingests` walks `companies` table (filtered `enabled=true`), and for each one without an in-flight ingest job (queued or running), enqueues `enqueue_ingest_greenhouse(slug)`.

Worker boot also seeds the `companies` table from `GREENHOUSE_COMPANIES` if it's empty (one-shot insert; no-op on subsequent boots).

**Step 5: Commit** `feat(api): periodic greenhouse scheduler in worker`

---

## Task 8: `classify_posting` runner

**Files:**
- Create: `api/app/services/classify.py` — `async classify_posting(db, *, posting_id) -> dict` calling Haiku via the existing agent SDK pattern. Returns `{tier, fit_score, rationale}` and writes the values into the posting row.
- Modify: `api/app/services/jobs_runner.py` — `run_classify_posting_job` registered as `"classify_posting"`.
- Modify: the `ingest_greenhouse` runner from Task 6 — for each newly-created posting, enqueue a `classify_posting` job.
- Test: `api/tests/test_classify.py` (mocked agent SDK), `api/tests/test_classify_runner.py`.

System prompt: a short prompt that takes the JD + the user's `Profile.preferences` and returns JSON `{tier: "dream"|"targeted"|"wide_net"|"skip", fit_score: 0..100, rationale: "..."}`. Strict JSON output. Skip = below threshold or matches a dealbreaker.

**Step 5: Commit** `feat(api): posting classification runner`

---

## Task 9: KB-aware tailor wrapper

**Files:**
- Create: `api/app/services/tailor_for_application.py`
- Test: `api/tests/test_tailor_for_application.py`

`async tailor_for_application(db, *, user_id, posting_id, on_progress=None) -> TailorForAppResult`:
1. Load posting + master resume + profile.
2. Retrieve top-8 KB chunks for the JD via `kb_ingest.retrieve(db, user_id=..., query=posting.description_text, k=8)`.
3. Call the existing `tailor_resume()` with the JD text plus a system-prompt addition that says "Use these knowledge-base notes to ground specific claims (do NOT invent): \n\n<chunk 1>\n<chunk 2>\n…".
4. Return `{variant_id, page_count, iterations, enforced, kb_chunks_used}`.

The wrapper does NOT modify `tailor.py`. It composes on top.

**Tests:** mock `tailor_resume` to return a fake result; assert the prompt-augmentation path is called with KB chunks; assert the result threads through.

**Step 5: Commit** `feat(api): kb-aware tailor wrapper`

---

## Task 10: Cover letter generator

**Files:**
- Create: `api/app/services/cover_letter.py`
- Test: `api/tests/test_cover_letter.py`

`async generate_cover_letter(db, *, user_id, posting_id) -> str`:
1. Retrieve top-6 KB chunks relevant to the JD.
2. Pull `Profile` (legal_name, links, narrative-relevant fields).
3. Call Sonnet with a focused prompt: "Write a cover letter for this role at this company. Use these KB notes for tone and content. Keep it under 250 words. No clichés."
4. Return the text.

Tests mock the agent SDK call; assert the prompt includes both profile + chunks.

**Step 5: Commit** `feat(api): cover letter generator`

---

## Task 11: Answer cache primitive

**Files:**
- Create: `api/app/services/answer_cache.py`
- Test: `api/tests/test_answer_cache.py`

```python
def normalize_question(text: str) -> str:
    """Lowercase, collapse whitespace, strip punctuation. Stable across casing."""

async def lookup(db, *, user_id, question: str) -> str | None:
    """Returns cached answer or None. Bumps last_used_at on hit."""

async def store(db, *, user_id, question: str, answer: str) -> None:
    """Upserts. Hash via sha256(normalize_question(question))."""
```

Used by the Greenhouse adapter (Task 14) and the agent fallback (Slice 5).

**Step 5: Commit** `feat(api): answer cache for short-answer reuse`

---

## Task 12: `prepare_application` runner — orchestrator

**Files:**
- Modify: `api/app/services/jobs_runner.py` — `run_prepare_application_job` reads payload `{posting_id}`:
  1. Compute `canonical_key = canonicalize(company, apply_url)`. Set on posting + future application row.
  2. Pre-submit dedup gate: if `applications.canonical_key` already exists for this `user_id`, mark posting `status="duplicate_skipped"` and exit (no application row created).
  3. Run `tailor_for_application` (emits progress events).
  4. Run `generate_cover_letter`.
  5. Predict `form_payload` (seed from profile + AnswerCache lookup for any short-answer questions Greenhouse advertises in the posting; for v1 we only know "Why this company?" by convention so seed that one).
  6. Insert `Application(status="prepared", mode="B", resume_variant_id=..., cover_letter_text=..., form_payload=..., canonical_key=...)`.
  7. Set posting `status="ready"`.
- Create: `api/app/services/canonical.py` with `canonicalize(company, apply_url) -> str`.
- Test: `api/tests/test_canonical.py`, `api/tests/test_prepare_application_runner.py`.

The runner is orchestration only — every primitive is in its own task.

**Step 5: Commit** `feat(api): prepare_application orchestrator runner`

---

## Task 13: Posting + application API routes

**Files:**
- Create: `api/app/routes/postings.py`:
  - `GET /postings?status=&tier=&limit=&offset=` — inbox.
  - `GET /postings/{id}` — detail.
  - `POST /postings/{id}/prepare` — enqueues `prepare_application` job, returns `{job_id}`.
  - `POST /postings/{id}/skip` — sets status to `skip`.
- Create: `api/app/routes/applications.py`:
  - `GET /applications?status=&limit=&offset=` — review queue (default `status="prepared"`).
  - `GET /applications/{id}` — detail with everything: tailored resume PDF, cover letter, form payload.
  - `POST /applications/{id}/submit` — enqueues `submit_application` job. Returns `{job_id}`.
  - `DELETE /applications/{id}` — cancel a prepared application.
- Modify: `api/app/main.py` — wire both routers.
- Test: `api/tests/test_postings_routes.py`, `api/tests/test_applications_routes.py`.

All routes gated by `Depends(require_user)`.

**Step 5: Commit** `feat(api): postings + applications routes`

---

## Task 14: Greenhouse Playwright submit adapter

**Files:**
- Create: `api/app/services/submit_adapters/__init__.py`
- Create: `api/app/services/submit_adapters/greenhouse.py`
- Test: `api/tests/test_greenhouse_submit_adapter.py`

The adapter does NOT run inside the `api` container — Playwright ships in a sibling `browser` container per the parent design. **However, for Slice 2 we run it inline in the worker container** to avoid standing up a new service. Worker container needs Playwright + Chromium installed (the `mcr.microsoft.com/playwright/python:v1.x.y-jammy` image has them; switch the api/worker Dockerfile to extend it, OR `pip install playwright && playwright install chromium` in the existing image — pick the lightest path).

```python
# api/app/services/submit_adapters/greenhouse.py

class SubmitContext:
    db: AsyncSession
    user_id: int
    application_id: int
    posting: JobPosting
    profile: Profile
    resume_pdf_path: str
    cover_letter_text: str
    form_payload: dict

class SubmitResult(TypedDict):
    confirmation_html: str
    confirmation_screenshot_path: str
    submitted_at: datetime

async def submit(ctx: SubmitContext, on_progress=None) -> SubmitResult:
    """Drive a Playwright session through the Greenhouse application form.

    Greenhouse forms have a stable enough DOM that we can hand-code selectors
    for the common fields (first_name, last_name, email, phone, resume upload,
    cover_letter textarea, common short-answer questions).
    """
```

Selectors live in `_GREENHOUSE_SELECTORS: dict[str, str]` at module top, easily updatable when Greenhouse ships UI changes. Each selector is tried; if not present, the field is skipped (some questions are optional). Mandatory fields with no selector match raise `MissingFieldError`, which the runner converts to a structured failure surfaced in the review queue.

`on_progress` emits events: `nav_to_form`, `filling_field`, `uploaded_resume`, `submitting`, `confirmed`.

**Tests:** integration test that boots a Playwright Chromium against a static HTML fixture mimicking the Greenhouse form, asserts the adapter fills + submits + captures the confirmation. No real Greenhouse posting.

**Step 5: Commit** `feat(api): greenhouse playwright submit adapter`

---

## Task 15: `submit_application` runner

**Files:**
- Modify: `api/app/services/jobs_runner.py` — `run_submit_application_job` reads payload `{application_id}`:
  1. Load application + posting + profile + resume PDF (write the PDF bytes to a temp file for upload).
  2. Re-check pre-submit dedup gate (fail → `duplicate_skipped`, no submission).
  3. Set `application.status="submitting"`.
  4. Call `greenhouse.submit(ctx, on_progress=...)`.
  5. On success: store confirmation HTML + screenshot path, set `status="submitted"`, set `submitted_at`.
  6. On failure: store error, set `status="errored"`, leave the application in the review queue for the user to retry.
  7. Mark posting `status="submitted"` on success.
- Test: `api/tests/test_submit_application_runner.py` (mocks the adapter).

**Step 5: Commit** `feat(api): submit_application runner`

---

## Task 16: Inbox UI

**Files:**
- Create: `web/src/routes/Inbox.tsx`
- Create: `web/src/components/PostingCard.tsx`
- Modify: `web/src/api.ts` — add posting helpers + types.
- Modify: `web/src/App.tsx` — add `'inbox'` view + nav.
- Test: `web/src/routes/Inbox.test.tsx`

Layout per the design doc Section 5: filter bar (tier, status, fit-score range, source, date), list rows (tier badge, fit chip, company, title, location, source icon, mode toggle [forced B for slice 2 — read-only pill], posted-N-days-ago, ⋯ overflow). Click row → side drawer with full JD + "Plan" tab + Overrides (skip).

Primary CTA on each row: **"Prepare application"** (calls `POST /postings/{id}/prepare`, navigates to the existing `/jobs` page filtered by the resulting job's batch_id so the user can watch progress).

Tests: render with mocked postings, assert filtering, assert prepare button calls the right endpoint.

**Step 5: Commit** `feat(web): inbox of ingested postings`

---

## Task 17: Review queue UI

**Files:**
- Create: `web/src/routes/Applications.tsx`
- Create: `web/src/components/ApplicationCard.tsx`
- Modify: `web/src/api.ts` — add application helpers.
- Modify: `web/src/App.tsx` — add `'applications'` view + nav.
- Test: `web/src/routes/Applications.test.tsx`

Per design doc Section 3: card per application showing tailored resume PDF (existing `PdfPreview` component), cover letter (rendered + edit-in-place), form payload (read-only summary), single **Submit** button (calls `POST /applications/{id}/submit`).

Errors from a previous failed submit show in the card with a "Retry submit" action.

Tests: render with mocked applications, assert submit calls the right endpoint, assert delete cancels.

**Step 5: Commit** `feat(web): review queue for prepared applications`

---

## Task 18: E2E smoke (LIVE_E2E gated)

**Files:**
- Create: `web/e2e/greenhouse-apply.spec.ts`

Flow (per the slice's done criteria):
1. Log in.
2. Force a manual `POST /jobs/ingest_greenhouse` for a known seeded company (need a small admin route or a CLI for tests; or call the worker function directly via a test-only endpoint guarded by a debug header).
3. Wait for at least one posting to appear in the inbox.
4. Click "Prepare" on a posting; wait for the application to land in the review queue.
5. Assert the application card has a resume PDF + cover letter + a Submit button.
6. (Optional, if `LIVE_GREENHOUSE_TARGET` env is set to a known test posting URL) click Submit, watch streamed progress, assert success.

Skip the live-submit branch if `LIVE_GREENHOUSE_TARGET` is unset.

**Step 5: Commit** `test(e2e): greenhouse ingest → prepare → review queue smoke`

---

## Done criteria for Slice 2

- A fresh boot of compose (`db`, `api`, `web`, `worker`) ingests Greenhouse postings every 15 min for the seeded companies.
- The Inbox shows postings with classification (tier + fit score).
- Clicking "Prepare" on a posting kicks off the existing job pipeline; progress streams via the existing `/jobs/{id}/events` SSE.
- The Review Queue shows the prepared application with a tailored one-page resume, a KB-grounded cover letter, and a form payload preview.
- Clicking Submit drives a real Greenhouse posting to completion via Playwright; confirmation HTML + screenshot are captured.
- The DB unique constraint on `applications.(user_id, canonical_key)` prevents double submission.

## Open items deferred (do not address in Slice 2)

- A-mode autonomous submit + captcha-pause + push notifications — Slice 3.
- `claude_router` (Max vs API key dispatch) — Slice 3.
- Lever / Ashby / Workable / email / URL-paste / agentic / GitHub-curated source adapters — Slice 4.
- Browser-agent fallback for unknown ATSs — Slice 5.
- Source-management UI (add/remove companies in-app) — Slice 4.
- Tier configuration UI — Slice 3.
- Recruiter-mail ingestion / status pipeline / auto-replies — out of scope per parent design.
