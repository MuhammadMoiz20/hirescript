# Mass-Apply Slice 4 — Source Breadth

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Broaden ingestion from one source (Greenhouse) to five (Greenhouse, Lever, Ashby, Workable, Gmail digest, URL paste). Formalize the `Source` interface so adapters are interchangeable, persist company allowlists in the DB instead of code, and give the user UI to add/remove companies and paste one-off job URLs.

**Architecture:** A new `Source` protocol abstracts `fetch_postings(slug) -> list[NormalizedPosting]`. The Greenhouse fetcher is rewritten against it (no behavior change), then Lever / Ashby / Workable adapters drop in as ~150 lines each. The `companies` table gains a `source` filter (already present from slice 2) and is exposed via CRUD routes. A new `gmail_digest` source polls a single Gmail inbox via IMAP every 30 min and uses Haiku to extract postings from job-alert emails. URL paste is a synchronous endpoint: user pastes a URL, we detect the ATS family, run the matching adapter on the single posting, and drop it into `job_postings`. No new submit adapters this slice — submission for non-Greenhouse postings simply marks `mode="B"` and waits for the user (Slice 5 wires Lever/Ashby/Workable submitters and the agent fallback).

**Tech Stack:** Existing FastAPI + async SQLAlchemy + Alembic + httpx + Postgres job queue + Anthropic SDK. New: `aioimaplib` for IMAP, `selectolax` (lighter than bs4) or reuse bs4 for HTML parsing.

**Reference docs (read before starting):**
- `docs/plans/2026-04-26-mass-apply-design.md` — parent design (source list, normalized job schema, application-level dedup).
- `docs/plans/2026-04-26-mass-apply-slice-2-greenhouse-apply.md` — slice 2 plan (Greenhouse adapter pattern).
- `docs/plans/2026-04-27-mass-apply-slice-3-tiering-amode.md` — slice 3 plan (since postings flow through classify → prepare regardless of source).
- `api/app/services/sources/greenhouse.py` — the existing concrete adapter to refactor against the new protocol.
- `api/app/services/sources/greenhouse_companies.py` — to be deleted; replaced by `companies` table seed.
- `api/app/services/jobs_runner.py::run_ingest_greenhouse_job` — generalize to `run_ingest_source_job`.

**Scope guardrails:**
- No new submit adapters. Postings from Lever/Ashby/Workable/email/URL-paste land in the inbox with `mode="B"`. The user prepares + submits manually until Slice 5 adds those adapters.
- Gmail only for email digest (single-tenant, app password). Generic IMAP defer to later if needed.
- URL paste recognizes Greenhouse, Lever, Ashby, Workable URL patterns. Anything else returns a "URL not recognized" 422 — no scraping fallback yet.
- LinkedIn / Indeed / Wellfound / agentic / GitHub-curated remain out of scope (Slice 5).
- Companies UI is a single CRUD list — no bulk import, no source-discovery wizard.

**Tests run inside Docker compose**: `docker compose run --rm api pytest`. Frontend: `cd web && npx vitest run`.

---

## Task 1: `Source` protocol + refactor Greenhouse onto it

**Files:**
- Create: `api/app/services/sources/protocol.py` — `Source` Protocol.
- Modify: `api/app/services/sources/greenhouse.py` — implement the protocol.
- Modify: `api/app/services/sources/__init__.py` — `SOURCES: dict[str, Source]` registry.
- Test: `api/tests/test_sources_protocol.py`.

```python
# api/app/services/sources/protocol.py
class NormalizedPosting(TypedDict):
    source_job_id: str
    title: str
    location: str | None
    apply_url: str
    description_html: str
    description_text: str
    meta: dict

class Source(Protocol):
    name: str  # "greenhouse" | "lever" | ...
    async def fetch_company_postings(
        self, slug: str, *, http: httpx.AsyncClient
    ) -> list[NormalizedPosting]: ...
    def matches_url(self, url: str) -> bool:
        """True if a pasted URL belongs to this source."""
    async def fetch_one_url(
        self, url: str, *, http: httpx.AsyncClient
    ) -> NormalizedPosting:
        """Fetch a single posting from a pasted URL. Raises ValueError if not a posting URL."""
```

The Greenhouse module gets `name = "greenhouse"`, a `matches_url` checking `boards.greenhouse.io` / `job-boards.greenhouse.io`, and a `fetch_one_url` that hits `/v1/boards/{slug}/jobs/{id}` if URL parses cleanly.

`SOURCES` registry — `{"greenhouse": GreenhouseSource()}` — is the only thing other modules import.

**Tests** assert: registry contains greenhouse; `matches_url` is correct; `fetch_company_postings` returns normalized shape (mocked httpx).

**Step 5: Commit** `refactor(api): source protocol + greenhouse implements it`

---

## Task 2: Generalize the ingest runner

**Files:**
- Modify: `api/app/services/jobs_runner.py` — rename `run_ingest_greenhouse_job` → `run_ingest_source_job`. Payload becomes `{source: str, company_slug: str}`. Dispatches via `SOURCES[payload["source"]]`. Keep `"ingest_greenhouse"` as a deprecated kind that just calls the new runner with `source="greenhouse"` (one slice of compat — drop in slice 5).
- Modify: `api/app/services/jobs_repo.py::enqueue_ingest_greenhouse` — keep (one-line wrapper around `enqueue_ingest_source(source="greenhouse", ...)`); add the new general helper.
- Test: extend `api/tests/test_ingest_greenhouse_runner.py` — pass via the new payload shape.

**Step 5: Commit** `refactor(api): generalize ingest runner over source registry`

---

## Task 3: Move company allowlist into the DB

**Files:**
- Create: `api/alembic/versions/0012_seed_lever_ashby_workable.py` — seeds new `companies` rows for the four ATS families with a small starter list (e.g. `lever:netflix`, `ashby:notion`, `workable:miro`). Existing greenhouse rows untouched.
- Delete: `api/app/services/sources/greenhouse_companies.py` (no callers after Task 2).
- Modify: `api/app/worker.py` — remove the boot-time seed-from-constant code (rows now seeded by migration).
- Test: extend `api/tests/test_migrations.py` — assert at least one row per source.

**Step 5: Commit** `refactor(api): companies seeded by migration, drop hardcoded list`

---

## Task 4: Lever adapter

**Files:**
- Create: `api/app/services/sources/lever.py`
- Modify: `api/app/services/sources/__init__.py` — register.
- Test: `api/tests/test_lever_fetch.py`.

API: `https://api.lever.co/v0/postings/{slug}?mode=json`. Each item has `id`, `text` (title), `categories.location`, `hostedUrl`, `descriptionPlain`, `description` (html). `matches_url` covers `jobs.lever.co/{slug}/{id}` and `lever.co/jobs/{...}`.

**Tests:** mock httpx, assert normalization. No real network.

**Step 5: Commit** `feat(api): lever source adapter`

---

## Task 5: Ashby adapter

**Files:**
- Create: `api/app/services/sources/ashby.py`
- Modify: `api/app/services/sources/__init__.py` — register.
- Test: `api/tests/test_ashby_fetch.py`.

Public API: `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`. Returns `{jobs: [{id, title, location, jobUrl, descriptionHtml, descriptionPlain}]}`. `matches_url` covers `jobs.ashbyhq.com/{slug}/{id}`.

**Step 5: Commit** `feat(api): ashby source adapter`

---

## Task 6: Workable adapter

**Files:**
- Create: `api/app/services/sources/workable.py`
- Modify: `api/app/services/sources/__init__.py` — register.
- Test: `api/tests/test_workable_fetch.py`.

API: `https://apply.workable.com/api/v1/widget/accounts/{slug}` (returns ids); per-job: `https://apply.workable.com/api/v3/accounts/{slug}/jobs/{shortcode}`. `matches_url` covers `apply.workable.com/{slug}/j/{shortcode}/`.

**Step 5: Commit** `feat(api): workable source adapter`

---

## Task 7: Companies CRUD routes

**Files:**
- Create: `api/app/routes/companies.py`:
  - `GET /companies?source=` — list.
  - `POST /companies` — body `{source, slug, display_name}`. Validates that `source` is in `SOURCES` and that `fetch_company_postings(slug)` returns at least one posting (sanity check; rejects bad slugs with 422).
  - `PATCH /companies/{id}` — toggle `enabled`, rename `display_name`.
  - `DELETE /companies/{id}` — soft delete (set `enabled=false`).
- Modify: `api/app/main.py` — wire router.
- Create: `api/app/schemas/company.py` — `CompanyOut`, `CompanyCreate`.
- Test: `api/tests/test_companies_routes.py`.

The POST sanity check is what stops typos from quietly producing zero ingest results. The actual fetch is mockable in tests.

**Step 5: Commit** `feat(api): companies CRUD routes`

---

## Task 8: Scheduler iterates over all sources

**Files:**
- Modify: `api/app/worker.py::_enqueue_due_ingests` — query `companies WHERE enabled=true` and enqueue one `ingest_source` job per `(source, slug)` that doesn't already have one in flight. (No code path is hardcoded to greenhouse anymore.)
- Test: extend `api/tests/test_worker.py` — fixture with two greenhouse and one lever company; assert three jobs enqueued.

**Step 5: Commit** `feat(api): scheduler enqueues ingest for every enabled company`

---

## Task 9: URL paste route

**Files:**
- Create: `api/app/routes/url_paste.py` — `POST /postings/from_url` with body `{url: str}`.
  - Iterate `SOURCES.values()`, find first `s.matches_url(url)`.
  - Call `s.fetch_one_url(url)` → `NormalizedPosting`.
  - Resolve / create the `companies` row by inferring slug from URL (each adapter exposes `slug_from_url(url) -> str`).
  - Upsert into `job_postings` with `status="new"`, enqueue `classify_posting`.
  - Return `JobPostingOut`.
  - Returns 422 if no source matches.
- Modify: each adapter — add `slug_from_url`.
- Modify: `api/app/main.py` — wire router.
- Test: `api/tests/test_url_paste.py` — mock httpx, post each of four URL shapes, assert posting created + classify job enqueued.

**Step 5: Commit** `feat(api): paste a job url to ingest one posting`

---

## Task 10: Gmail digest source

**Files:**
- Create: `api/app/services/sources/gmail_digest.py`
- Test: `api/tests/test_gmail_digest.py`

Two concerns combined in one module (single-tenant, small):

1. **IMAP poll** — `aioimaplib`, env vars `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_DIGEST_LABEL` (default `JobAlerts`). Connect to `imap.gmail.com:993` (SSL), select label, fetch `UNSEEN` messages, return `[(uid, html_body)]`.
2. **Extract** — Haiku call per email: "Extract every job posting from this email. For each, return `{company, title, apply_url, location?}`. Output strict JSON list. Empty list if none." `claude_router.choose("classify")` for the model.

`async poll_and_ingest(db, *, user_id) -> int`:
- For each unread email, run extract.
- For each extracted posting, upsert into `job_postings` with `source="gmail_digest"`, `source_job_id=sha256(apply_url)`, `apply_url=...`. (No company row required for email-sourced postings — `company_id` nullable for this source. If the apply_url is a Greenhouse/Lever/Ashby/Workable URL, attach a `meta.detected_source` so a future enrichment pass can re-fetch the canonical posting.)
- Mark IMAP messages as `\Seen`.
- Returns the number of postings created.

**Tests** mock both `aioimaplib` and the Anthropic client; assert: zero-postings email is a no-op; multi-posting email creates multiple rows; duplicate apply_url across runs collapses via the upsert.

**Step 5: Commit** `feat(api): gmail digest source — imap + haiku extraction`

---

## Task 11: `ingest_gmail` runner + scheduler tick

**Files:**
- Modify: `api/app/services/jobs_runner.py` — register `"ingest_gmail"` runner (calls `gmail_digest.poll_and_ingest`).
- Modify: `api/app/services/jobs_repo.py` — add `enqueue_ingest_gmail`.
- Modify: `api/app/worker.py::_scheduler` — every 30 minutes (`GMAIL_POLL_INTERVAL_SEC`, default 1800) enqueue an `ingest_gmail` job if none in flight. Skip entirely if `GMAIL_USER` env var is unset.
- Test: `api/tests/test_ingest_gmail_runner.py`, extend `test_worker.py`.

**Step 5: Commit** `feat(api): periodic gmail digest ingest`

---

## Task 12: Companies admin page

**Files:**
- Create: `web/src/routes/Companies.tsx` — table grouped by source, add/remove/enable rows.
- Modify: `web/src/api.ts` — add `listCompanies`, `createCompany`, `updateCompany`, `deleteCompany`.
- Modify: `web/src/App.tsx` — add `'companies'` route under the existing Settings nav group.
- Test: `web/src/routes/Companies.test.tsx`.

Layout: source filter chips at top; rows show `display_name`, slug, enabled toggle, delete button. Add-company form at bottom: source dropdown, slug, display name → POST.

**Step 5: Commit** `feat(web): companies admin page`

---

## Task 13: URL paste UI

**Files:**
- Modify: `web/src/routes/Inbox.tsx` — add a "Paste job URL" button in the toolbar that opens a small dialog (single text input + submit). On success, navigates to the new posting's drawer.
- Modify: `web/src/api.ts` — add `pasteJobUrl(url)`.
- Create: `web/src/components/PasteUrlDialog.tsx`.
- Test: `web/src/components/PasteUrlDialog.test.tsx`, extend `web/src/routes/Inbox.test.tsx`.

**Step 5: Commit** `feat(web): paste a job url from inbox`

---

## Task 14: Inbox source filter

**Files:**
- Modify: `web/src/routes/Inbox.tsx` — add a `source` filter chip group (greenhouse/lever/ashby/workable/gmail_digest/url_paste). Wire into the existing `GET /postings` query.
- Modify: `api/app/routes/postings.py` — accept `source=` query param.
- Test: extend `api/tests/test_postings_routes.py` and `web/src/routes/Inbox.test.tsx`.

**Step 5: Commit** `feat(api+web): filter inbox by source`

---

## Task 15: E2E smoke (LIVE_E2E gated)

**Files:**
- Create: `web/e2e/sources.spec.ts`

Flow:
1. Log in.
2. Add a Lever company via the new Companies page (mocked at the network layer to return one posting).
3. Trigger scheduler; assert posting appears in inbox with source=lever.
4. Paste a Workable URL via the Inbox dialog (mocked); assert the new posting appears in inbox with source=workable.
5. (If `LIVE_GMAIL_USER` env set) trigger an `ingest_gmail` job; assert ≥0 postings ingested.

**Step 5: Commit** `test(e2e): multi-source ingest smoke`

---

## Done criteria for Slice 4

- `SOURCES` registry holds Greenhouse + Lever + Ashby + Workable + Gmail; the scheduler enqueues an ingest job per enabled `(source, slug)` pair every 15 min.
- A user can add/remove companies of any ATS family via the Companies admin page; new postings appear in the inbox within one scheduler tick.
- Pasting any Greenhouse/Lever/Ashby/Workable posting URL creates a single posting on the spot.
- A Gmail account with a `JobAlerts` label is polled every 30 min; postings extracted by Haiku land in the inbox tagged `gmail_digest`.
- Inbox can be filtered by source.
- All postings — regardless of source — flow through the existing classify → prepare → review pipeline. Submission still works only for Greenhouse (others stay in B-mode awaiting Slice 5).

## Open items deferred (do not address in Slice 4)

- Lever / Ashby / Workable Playwright submit adapters — Slice 5.
- Browser-agent fallback for unknown ATSs — Slice 5.
- LinkedIn / Indeed / Wellfound scrapers — Slice 5.
- GitHub-curated source — Slice 5.
- Generic IMAP (non-Gmail) — out of scope until needed.
- Source-discovery wizard, bulk company import — out of scope.
