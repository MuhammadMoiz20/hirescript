# Phase 2 — Tailor to Job Description + Variants

> **For Claude:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.

**Goal:** User pastes a JD; we extract protected terms, then generate a variant resume tailored to the JD (Sonnet 4.6 default, Opus 4.7 when "Deep tailor"). The variant is its own row linked to the master resume and to the saved JD. Same one-page enforcement applies.

**Anchor:** `docs/plans/2026-04-24-resume-maker-design.md` — "Core User Flows" §2 ("Tailor to Job Description") and §4 ("Manage saved resumes").

**Scope:**
- `job_descriptions` table (id, user_id, title, company, url, raw_text, parsed_json, created_at).
- JD keyword extraction (Haiku 4.5) → stored in `parsed_json.keywords`.
- New variant resume creation linked to master + JD.
- "Tailor to JD" agent endpoint, defaults to Sonnet, opt-in to Opus via `deep_tailor: true`.
- JD-derived keywords merged into protected terms via existing `resolve_protected_terms`.
- Frontend: "Tailor to JD" modal (title, company, URL, JD text, deep-tailor toggle) launching a tailoring run that produces a variant.
- List view groups variants under master with JD title/company.

**Out of scope:** Section form editor, version history, MinIO, deployment.

---

## Task 1: `job_descriptions` table + Alembic 0003

**Files:**
- Modify: `api/app/models.py` — add `JobDescription` + `Resume.job_description_id` FK.
- Create: `api/alembic/versions/0003_job_descriptions.py`.
- Create: `api/tests/test_jd_model.py`.

`JobDescription`: `id pk`, `user_id int FK users.id`, `title str(200)`, `company str(200)`, `url str(500) nullable`, `raw_text text`, `parsed_json jsonb default '{}'`, `created_at timestamptz default now()`.

`Resume`: add `job_description_id int FK job_descriptions.id nullable` (variants link to JDs; master can be null).

Test: create JD + variant resume that references it; assert relationship works through SQLAlchemy.

**Commit:** `feat(api): job_descriptions table + variant linkage`

---

## Task 2: JD parser service (keyword extraction via Haiku 4.5)

**Files:**
- Create: `api/app/services/jd_parser.py`.
- Create: `api/tests/test_jd_parser.py`.

```python
async def extract_keywords(*, raw_text: str) -> list[str]:
    """Use agent service (Haiku 4.5) to return a flat list of canonical keywords/verbs.
    Mocked in tests."""
```

Internally calls `agent.query_json(...)` (add a thin synchronous JSON-envelope helper to `agent.py` if not already there) with a system prompt asking for `{"keywords":[...]}`, validates shape.

Tests mock the SDK; assert dedup, lowercased.

**Commit:** `feat(api): JD keyword extractor`

---

## Task 3: Tailor service

**Files:**
- Create: `api/app/services/tailor.py`.
- Create: `api/tests/test_tailor.py`.

```python
@dataclass(frozen=True)
class TailorResult:
    variant_latex: str
    pdf: bytes
    page_count: int
    enforced: bool
    iterations: int
    tier_history: list[str]
    keywords_used: list[str]

async def tailor_resume(
    *,
    master_latex: str,
    jd_text: str,
    user_pinned: list[str],
    deep_tailor: bool = False,
) -> TailorResult: ...
```

Flow:
1. `extract_keywords(raw_text=jd_text)` → keywords.
2. `resolve_protected_terms(user_pinned=user_pinned, jd_terms=keywords)`.
3. Call `agent` once at tier `opus` if `deep_tailor` else `sonnet` to generate the full tailored LaTeX (full document in JSON envelope, like repair_overflow). Reuse the strict-JSON path.
4. Run `enforce_one_page(...)` on the result.
5. Return.

Tests mock all three deps; verify routing, keyword merge, enforcer invocation.

**Commit:** `feat(api): tailor-to-JD service`

---

## Task 4: Tailor endpoint

**Files:**
- Modify: `api/app/routes/resumes.py` (or create `routes/jd.py`).
- Modify: `api/app/schemas.py`.
- Create: `api/tests/test_tailor_endpoint.py`.

`POST /resumes/{id}/tailor` — body `{title, company, url?, jd_text, deep_tailor?: bool}`. Authed.
- Validates resume is `kind == "master"`.
- Persists `JobDescription`.
- Calls `tailor_resume`.
- Persists new `Resume` row with `kind="variant"`, `parent_id=id`, `job_description_id=jd.id`, `latex_source=result.variant_latex`, `name=f"{master.name} — {company}"`.
- Returns `{variant: ResumeOut, jd_id, page_count, enforced, iterations}`.

Reject with 422 if `enforced=False`. Don't persist in that case.

**Commit:** `feat(api): tailor-to-JD endpoint creates variant resume`

---

## Task 5: Variant-aware list endpoint

**Files:**
- Modify: `api/app/routes/resumes.py` (`GET /resumes` extension or new `GET /resumes/grouped`).
- Modify: `api/app/schemas.py` (add `ResumeGroup` shape).
- Modify: `api/tests/test_resumes.py` (add coverage).

`GET /resumes/grouped` returns:
```json
[{"master": ResumeOut, "variants": [{...ResumeOut, "jd_title": str, "jd_company": str}]}]
```

Keep the flat `GET /resumes` for backward compat with the editor.

**Commit:** `feat(api): grouped resumes view (master + variants)`

---

## Task 6: Frontend api client extensions

**Files:**
- Modify: `web/src/api.ts`.

Add: `tailorToJd(masterId, body)`, `listGroupedResumes()`.

**Commit:** `feat(web): api client tailor + grouped list`

---

## Task 7: Tailor modal component

**Files:**
- Create: `web/src/components/TailorModal.tsx`.
- Create: `web/src/components/TailorModal.test.tsx`.

Form fields: title (required), company (required), url, jd_text (textarea required), deep_tailor checkbox. On submit calls `tailorToJd`, shows progress (busy state, no streaming for v1), surfaces success/failure. On success, returns the new variant id via `onCreated` callback.

**Commit:** `feat(web): TailorModal component`

---

## Task 8: ResumeList variants grouping + tailor button

**Files:**
- Modify: `web/src/routes/ResumeList.tsx`.
- Modify: `web/src/routes/ResumeList.test.tsx`.

Switch list to `listGroupedResumes`. Render master with nested variants below it. Each master shows a "Tailor to JD" button that opens `TailorModal`. Variant rows show JD title/company.

**Commit:** `feat(web): grouped resume list with tailor action`

---

## Task 9: E2E smoke

**Files:**
- Create: `web/e2e/tailor.spec.ts`.

Stub `POST /resumes/{id}/tailor` and `GET /resumes/grouped`. Verify modal flow → variant appears in list.

**Commit:** `test(web): tailor e2e smoke`

---

## Done criteria

- API: 43 + new tests (~12) passing.
- Vitest: 11 + new (~3) passing.
- Playwright: 2 + tailor (1) passing.
- User can paste a JD, get a variant resume that compiles to 1 page (or fails loudly), see it grouped under the master.

Next plan: `2026-04-XX-section-form-editor.md`.
