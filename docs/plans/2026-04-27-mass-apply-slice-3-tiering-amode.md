# Mass-Apply Slice 3 — Tiering + A-Mode for Greenhouse

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make HireScript apply autonomously to Greenhouse postings under a configurable per-tier policy — classify into `dream/targeted/wide_net/skip`, route models per tier, run an autonomous submit path with daily caps, captcha-pause + ntfy push, and a Haiku verifier that blocks any submission with unsupported claims.

**Architecture:** Adds three new tables (`tiers`, `claude_usage`, `notifications`), one new module (`claude_router`), one new pipeline stage (`verify`), and one new runner (`autonomous_submit_loop`). Existing `submit_application` runner gains an `A` branch that skips the human gate but still respects the daily cap and the verify gate. Push notifications go out via ntfy.sh — single `NTFY_TOPIC` env var, no third-party SDK. Frontend `Tiers.tsx` is rewired from its read-only stub to CRUD against the new table.

**Tech Stack:** Existing FastAPI + async SQLAlchemy + Alembic + Pydantic v2 + httpx + Playwright + Postgres job queue + Anthropic Agent SDK. New: ntfy.sh HTTP push (httpx), Anthropic Python SDK (API-key path) alongside Agent SDK (Max path).

**Reference docs (read before starting):**
- `docs/plans/2026-04-26-mass-apply-design.md` — parent design (tiering policy, claude_router, verify gate, A-mode rules).
- `docs/plans/2026-04-26-mass-apply-slice-2-greenhouse-apply.md` — slice 2 plan (the runners and tables this slice extends).
- `api/app/services/jobs_runner.py` — runner dispatch table; `RUNNERS` registers new kinds.
- `api/app/services/classify.py` — already returns `tier`; this slice gates on that tier.
- `api/app/services/submit_adapters/greenhouse.py` — Playwright adapter; this slice extends it with a captcha-pause callback.
- `api/app/services/tailor_for_application.py` — wrap with model selection from `claude_router`.
- `web/src/routes/Tiers.tsx` — read-only stub with placeholder constant; rewire to fetched + editable data.

**Scope guardrails:**
- Greenhouse only. Lever / Ashby / Workable arrive in Slice 4. The captcha-pause + verify behavior generalizes through interfaces but is exercised by exactly one adapter.
- ntfy.sh only. No Pushover, no email, no SMS. One topic per single-tenant install.
- Tier policy stored in the new `tiers` table from day one; the four rows are seeded by an Alembic migration with the recommended defaults below.
- A-mode runs from a worker scheduler, not the UI. The UI surfaces history + lets the user pause A-mode globally and per-tier.
- Verify is a hard gate for A-mode; B-mode shows verifier output as advisory.
- No Redis. Max-window counter lives in the new `claude_usage` table (rolling 5-hour query).
- Recruiter mail / status pipeline / cooldown remain out of scope per parent design.

**Tests run inside Docker compose**: `docker compose run --rm api pytest`. Frontend: `cd web && npx vitest run`.

---

## Task 1: New tables — `tiers`, `claude_usage`, `notifications`

**Files:**
- Create: `api/alembic/versions/0010_tiers_usage_notifications.py`
- Test: extend `api/tests/test_migrations.py`

**Schema:**

`tiers` (seeded by this migration with four rows below):
- `id` int PK
- `slug` text not null unique — one of `"dream" | "targeted" | "wide_net" | "skip"`
- `display_name` text not null
- `min_fit_score` int not null — inclusive lower bound the classifier uses to assign this tier
- `daily_cap` int not null — max applications per UTC day in A-mode (`0` disables A-mode for this tier)
- `default_mode` text not null — `"A" | "B"`
- `tailor_model` text not null — `"sonnet-4.6" | "opus-4.7" | "haiku-4.5"`
- `classify_model` text not null default `"haiku-4.5"`
- `enabled` bool not null default true
- `updated_at` timestamptz default now()

Seed rows:

| slug | min_fit | daily_cap | default_mode | tailor_model |
|---|---|---|---|---|
| `dream` | 85 | 0 (∞ via NULL? — use a large sentinel `999`) | B | opus-4.7 |
| `targeted` | 65 | 20 | A | sonnet-4.6 |
| `wide_net` | 40 | 50 | A | sonnet-4.6 |
| `skip` | 0 | 0 | B | haiku-4.5 |

(`dream` defaults to B and an effectively-unlimited cap because the user wants to eyeball top-tier applications even when running autonomous.)

`claude_usage`:
- `id` bigint PK
- `client` text not null — `"max" | "api"`
- `model` text not null
- `task_kind` text not null — short label: `"tailor" | "classify" | "verify" | "cover_letter" | "research"`
- `input_tokens` int not null default 0
- `output_tokens` int not null default 0
- `started_at` timestamptz not null default now()
- Index: `(client, started_at desc)` — for the rolling-5-hour counter.

`notifications`:
- `id` bigint PK
- `user_id` int FK `users.id` not null
- `kind` text not null — `"captcha_pause" | "submit_failed" | "verify_blocked" | "daily_summary" | "amode_paused"`
- `title` text not null
- `body` text not null
- `meta` jsonb not null default `'{}'::jsonb` — refs like `{"application_id": 12}`.
- `delivered_at` timestamptz — null until ntfy POST succeeds.
- `read_at` timestamptz — for the in-app drawer.
- `created_at` timestamptz not null default now()
- Index: `(user_id, created_at desc)`.

**Tests** (extend `test_migrations.py`):

```python
@pytest.mark.asyncio
async def test_slice3_tables_exist():
    async with engine.connect() as conn:
        for t in ("tiers", "claude_usage", "notifications"):
            assert (await conn.execute(text(f"SELECT to_regclass('{t}')"))).scalar() == t

@pytest.mark.asyncio
async def test_tiers_seeded():
    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT slug FROM tiers ORDER BY slug"))).all()
        assert {r[0] for r in rows} == {"dream", "targeted", "wide_net", "skip"}
```

**Step 5: Commit** `feat(api): tiers, claude_usage, notifications tables`

---

## Task 2: SQLAlchemy models + Pydantic schemas

**Files:**
- Modify: `api/app/models.py` — append `Tier`, `ClaudeUsage`, `Notification`.
- Create: `api/app/schemas/tier.py` — `TierOut`, `TierUpdate`.
- Create: `api/app/schemas/notification.py` — `NotificationOut`.
- Test: `api/tests/test_tier_schemas.py`.

`TierUpdate` only allows mutating `daily_cap`, `default_mode`, `tailor_model`, `enabled` — `slug` and `min_fit_score` are immutable in v1 (changing thresholds reshuffles classified postings retroactively, which we do not handle here).

**Step 5: Commit** `feat(api): tier + notification models and schemas`

---

## Task 3: `claude_router` — Max-vs-API client selection

**Files:**
- Create: `api/app/services/claude_router.py`
- Test: `api/tests/test_claude_router.py`

API:

```python
class ClientChoice(TypedDict):
    client: Literal["max", "api"]
    model: str

async def choose(
    db: AsyncSession,
    *,
    task_kind: Literal["tailor", "classify", "verify", "cover_letter", "research"],
    tier_slug: str | None = None,
) -> ClientChoice: ...

async def record_usage(
    db: AsyncSession,
    *,
    client: Literal["max", "api"],
    model: str,
    task_kind: str,
    input_tokens: int,
    output_tokens: int,
) -> None: ...

async def max_window_load(db: AsyncSession) -> float:
    """Returns 0.0..1.0 — how full the rolling 5-hour Max window is.

    Tokens are summed from `claude_usage` where client='max' AND
    started_at >= now() - interval '5 hours'. The denominator is
    the env-var `MAX_WINDOW_TOKEN_BUDGET` (default 4_000_000).
    """
```

Routing rules (simple, replaceable):

```
task_kind == "classify"      → API-key Haiku (no Max window risk)
task_kind == "cover_letter"  → API-key Haiku
task_kind == "verify"        → API-key Haiku
task_kind == "tailor"        → Max Sonnet/Opus by tier; falls back to API-key
                                Sonnet if max_window_load() > 0.85
task_kind == "research"      → Max Sonnet; skip task if window > 0.85
```

The actual SDK clients live in two thin singletons (`_max_client()` returning the existing Agent SDK client; `_api_client()` returning a new `anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])`). `claude_router.choose` only returns the choice — callers fetch the client via separate `get_max_client()` / `get_api_client()` accessors. Tests mock both.

**Tests** assert: classify always picks API; tailor under-budget picks Max; tailor over-budget picks API; record_usage writes a row; window-load math correct against a small fixture set.

**Step 5: Commit** `feat(api): claude_router for max-vs-api dispatch`

---

## Task 4: Wire `claude_router` into existing services

**Files:**
- Modify: `api/app/services/classify.py` — replace direct agent call with `choose("classify")` + `record_usage`.
- Modify: `api/app/services/tailor.py` (or `tailor_for_application.py` if that's the wrapper) — `choose("tailor", tier_slug=...)` to pick model; `record_usage` after each call.
- Modify: `api/app/services/cover_letter.py` — `choose("cover_letter")` + `record_usage`.
- Test: extend the existing tests for each service to assert `record_usage` is called and the right client is used (mock `claude_router`).

This is a refactor — no behavior change beyond model selection. The slice 2 tests should still pass after monkeypatching `claude_router.choose` to return the historical defaults.

**Step 5: Commit** `refactor(api): route claude calls through claude_router`

---

## Task 5: Tier policy CRUD routes

**Files:**
- Create: `api/app/routes/tiers.py` — `GET /tiers`, `PATCH /tiers/{slug}`.
- Modify: `api/app/main.py` — wire router.
- Test: `api/tests/test_tiers_routes.py`.

`PATCH` accepts a `TierUpdate` body and returns the updated `TierOut`. Setting `daily_cap=0` immediately disables A-mode for that tier; the autonomous loop (Task 9) re-reads on each pass, so no restart needed.

All routes gated by `Depends(require_user)`.

**Step 5: Commit** `feat(api): tier policy CRUD routes`

---

## Task 6: Verify pass — Haiku claim-grounding gate

**Files:**
- Create: `api/app/services/verify.py`
- Test: `api/tests/test_verify.py`

```python
class VerifyResult(TypedDict):
    ok: bool
    issues: list[str]   # one bullet per unsupported claim
    rationale: str

async def verify_application(
    db: AsyncSession, *, application_id: int
) -> VerifyResult: ...
```

Loads the tailored resume LaTeX + cover letter + `Profile` + the top-12 KB chunks for the JD. Sends to Haiku with a strict system prompt:

> "You verify that every concrete claim in the candidate's tailored materials (resume + cover letter) is supported by the profile or the KB notes provided. Concrete claims = job titles, employers, dates, metrics, technologies, education. List any claim that cannot be grounded. Output strict JSON: `{ok: bool, issues: [..], rationale: \"..\"}`."

Returns the parsed JSON. `record_usage` after the call. The verifier never edits — it only judges.

**Tests** mock the Anthropic client and assert:
- Strict JSON parse failure raises `AgentError`.
- An `ok=false` result is propagated faithfully.
- Verify is registered with `task_kind="verify"` in `claude_router.choose`.

**Step 5: Commit** `feat(api): verify pass for grounding tailored claims`

---

## Task 7: Wire verify into `prepare_application`

**Files:**
- Modify: `api/app/services/jobs_runner.py::run_prepare_application_job` — after the application row is inserted, call `verify_application`. Persist `VerifyResult` onto the application as a new column.
- Create: `api/alembic/versions/0011_application_verify.py` — adds `verify_ok bool`, `verify_issues jsonb default '[]'::jsonb`, `verify_rationale text` to `applications`.
- Modify: `api/app/models.py::Application` + `api/app/schemas/application.py` — surface the new fields.
- Test: extend `api/tests/test_prepare_application_runner.py`.

Verify failure does **not** stop preparation — it only writes the result. The submit step (Task 8 + Task 9) decides whether to gate on it.

**Step 5: Commit** `feat(api): persist verifier output on applications`

---

## Task 8: Captcha-pause callback in the Greenhouse adapter

**Files:**
- Modify: `api/app/services/submit_adapters/greenhouse.py::submit` — accept an `on_captcha: Callable[[CaptchaContext], Awaitable[None]] | None = None` callback. After clicking Submit, watch for known captcha selectors (`iframe[src*="recaptcha"]`, `iframe[title*="captcha"]`, `[data-testid*="captcha"]`, `text=/are you human/i`). On detection, raise a new `CaptchaPauseRequired` exception carrying the page screenshot bytes and current URL. The runner (Task 9) catches it.
- Modify: the existing `CaptchaPauseRequired` import path (add to `submit_adapters/__init__.py`).
- Test: extend `api/tests/test_greenhouse_submit_adapter.py` — fixture HTML with a fake captcha iframe; assert `CaptchaPauseRequired` raised.

**Step 5: Commit** `feat(api): captcha detection in greenhouse submit adapter`

---

## Task 9: A-mode submit path + per-tier daily cap

**Files:**
- Modify: `api/app/services/jobs_runner.py::run_submit_application_job` — branch on `application.mode`:
  - `"B"`: behavior unchanged from slice 2.
  - `"A"`:
    1. Re-load `Tier` row by `application.posting.tier`.
    2. If `tier.daily_cap == 0` or today's submitted count for this tier ≥ `tier.daily_cap`, mark `application.status="prepared"` (i.e. leave for review) and return without raising.
    3. If `application.verify_ok is False`, write a `verify_blocked` notification and return without submitting.
    4. Otherwise call the adapter with `on_captcha=_captcha_handler(application_id)`.
- Create: `api/app/services/notifications.py` — `async send(db, *, kind, title, body, meta) -> Notification` writes the row and POSTs to ntfy (`NTFY_TOPIC` env var; URL `https://ntfy.sh/{topic}`). Failure to reach ntfy logs but does not raise — the row remains with `delivered_at=None`.
- The captcha handler: writes a `captcha_pause` notification with the screenshot path, sets `application.status="captcha_pause"` (new status — extend the schema docstring), then raises `CaptchaPauseRequired` to abort the runner cleanly.
- Test: `api/tests/test_amode_submit.py` — covers cap-hit, verify-blocked, captcha-pause, happy-path. Mocks ntfy via httpx mock.

**Step 5: Commit** `feat(api): a-mode submit with daily cap + captcha-pause + ntfy`

---

## Task 10: Autonomous submit scheduler

**Files:**
- Modify: `api/app/worker.py::_scheduler` — extend the existing 15-minute scheduler to also enqueue `submit_application` jobs for every `Application` whose `status="prepared"`, `mode="A"`, and whose tier still has cap headroom today. Skip if a `submit_application` job for that application is already queued/running.
- Modify: `api/app/services/jobs_repo.py` — add `count_submitted_today_for_tier(db, *, tier_slug) -> int`.
- Test: extend `api/tests/test_worker.py` with a scenario that prepares 3 A-mode applications under a tier with `daily_cap=2` and asserts only 2 submit jobs are enqueued.

A global kill-switch env var `AUTONOMOUS_SUBMIT_DISABLED=1` short-circuits the entire branch — used during incidents.

**Step 5: Commit** `feat(api): scheduler enqueues a-mode submits within daily caps`

---

## Task 11: Notifications API + ntfy delivery

**Files:**
- Create: `api/app/routes/notifications.py`:
  - `GET /notifications?unread=` — list, newest first.
  - `POST /notifications/{id}/read` — set `read_at`.
- Modify: `api/app/main.py` — wire router.
- Test: `api/tests/test_notifications_routes.py`.

The ntfy POST itself happens in `services/notifications.py::send` (Task 9). This task adds the read API surface for the frontend drawer that already exists.

**Step 5: Commit** `feat(api): notifications routes`

---

## Task 12: A-mode resume from review queue

**Files:**
- Modify: `api/app/routes/applications.py` — add `POST /applications/{id}/promote_to_A` and `POST /applications/{id}/pause_A`. Promote sets `mode="A"` and clears any `captcha_pause` status. Pause sets `mode="B"`.
- Test: extend `api/tests/test_applications_routes.py`.

Used by the frontend (Task 14) to flip individual applications between modes after a captcha pause is resolved.

**Step 5: Commit** `feat(api): toggle a-mode per application`

---

## Task 13: Tiers page — wire to backend

**Files:**
- Modify: `web/src/routes/Tiers.tsx` — replace the hardcoded `TIERS` constant with `useEffect` fetching `GET /tiers`. Each card becomes editable (daily cap, default mode, tailor model). PATCH on blur. Remove the "Slice 3 will introduce…" banner.
- Modify: `web/src/api.ts` — add `listTiers()`, `updateTier(slug, patch)`.
- Test: `web/src/routes/Tiers.test.tsx` — mock fetch, render four tiers, edit `daily_cap`, assert PATCH fires.

Visual layout untouched — only the data source and edit affordances change.

**Step 5: Commit** `feat(web): tiers page wired to live policy`

---

## Task 14: Queue + History — surface A-mode + captcha pauses

**Files:**
- Modify: `web/src/routes/Queue.tsx` (or `Applications.tsx` if that's the actual path) — show `mode="A"` badge, captcha-pause banner with "Resolve & resume A" button (calls `promote_to_A` after the user taps Submit), verify-blocked banner with "Edit & retry".
- Modify: `web/src/components/QueueCard.tsx` — render the badges.
- Modify: `web/src/api.ts` — add `promoteToA(id)`, `pauseA(id)`.
- Test: extend `web/src/routes/Queue.test.tsx` and `web/src/components/QueueCard.test.tsx`.

**Step 5: Commit** `feat(web): a-mode + captcha + verify banners in queue`

---

## Task 15: E2E smoke (LIVE_E2E gated)

**Files:**
- Create: `web/e2e/amode-submit.spec.ts`

Flow:
1. Log in.
2. Set `targeted` tier `daily_cap=1` via the Tiers UI.
3. Seed two prepared A-mode applications via a test admin endpoint (or directly via factory).
4. Trigger the scheduler (existing test admin route) and wait.
5. Assert exactly one submitted, one still `prepared`.
6. Assert one notification of kind `captcha_pause` if the test fixture HTML includes a captcha iframe; otherwise assert the success path.

**Step 5: Commit** `test(e2e): a-mode submit + cap smoke`

---

## Done criteria for Slice 3

- `tiers` table seeded with four rows; Tiers page edits persist; `daily_cap=0` disables A-mode for that tier within one scheduler tick.
- A prepared A-mode application is auto-submitted by the worker scheduler when within cap.
- Verify pass runs after every `prepare_application`; an `ok=false` result blocks A-mode submission and surfaces a notification.
- A captcha encountered mid-submit pauses the application, writes a notification, and POSTs to ntfy.
- All Anthropic calls are routed through `claude_router`; `claude_usage` rows accumulate; over-budget tailor calls fall back to the API-key client.
- The user can promote/pause individual applications between modes from the Queue UI.

## Open items deferred (do not address in Slice 3)

- Lever / Ashby / Workable / email / URL-paste — Slice 4.
- Browser-agent fallback for unknown ATSs — Slice 5.
- Cooldown-aware reapply, recruiter-mail ingestion, status pipeline — out of scope per parent design.
- Real Redis / Arq — `claude_usage` table is good enough for single-tenant.
