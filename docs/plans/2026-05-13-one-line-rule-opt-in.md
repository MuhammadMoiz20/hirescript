# One-Line-Per-Bullet Rule: Opt-In — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make wrap-aware enforcement (one-line-per-bullet) a per-resume opt-in flag, set at create/onboard/tailor time, with a post-hoc "save-as-new" action that produces a one-line-enforced sibling resume.

**Architecture:** Adds `Resume.one_line_per_bullet: bool` (existing rows backfill to `true`, new-row default `false`). `compile_latex` and `enforce_one_page` gain an `inject_wrap_shim` / `detect_wraps` toggle that skips the wrap shim and naturally drops all `HS_WRAP:` hints, leaving page-count and `Overfull \hbox` repair untouched. All five enforcement call-sites (create, onboard tex/pdf, tailor, repair) thread the flag from the request/persisted resume. A new `POST /resumes/{id}/enforce_one_line` endpoint runs the enforcer with `detect_wraps=True` against any resume and persists the result as a new sibling resume (parent = source). The frontend gains a checkbox in three dialogs + a button on the editor.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, Alembic, Pydantic v2, pytest. React 18, TS, Vitest.

**Background reading (skim before starting):**
- `docs/plans/2026-05-13-one-line-rule-opt-in-design.md` (the design)
- `docs/plans/2026-04-27-wrap-aware-enforcement-design.md` (how wrap detection works today)
- `api/app/services/compile.py`, `api/app/services/enforcer.py`, `api/app/services/latex_shim.py`
- `api/app/routes/resumes.py`, `api/app/services/onboard.py`, `api/app/services/tailor.py`, `api/app/services/jobs_runner.py`

**Commit style:** conventional commits, one commit per task.

---

## Task 1: Add `one_line_per_bullet` column to Resume

**Files:**
- Modify: `api/app/models.py:32-59` (Resume class — add column)
- Create: `api/alembic/versions/<auto>_resume_one_line_per_bullet.py`

**Step 1: Add column to ORM**

In `api/app/models.py` Resume class, after `protected_terms` and before `created_at`:

```python
one_line_per_bullet: Mapped[bool] = mapped_column(
    Boolean, nullable=False, server_default=text("true"), default=False
)
```

Ensure `Boolean` and `text` are imported from `sqlalchemy`.

**Step 2: Generate the migration**

Run: `docker compose run --rm api alembic revision --autogenerate -m "resume one_line_per_bullet"`

Open the generated file. Confirm it adds `one_line_per_bullet` as `Boolean`, `nullable=False`, `server_default=sa.text("true")`. Server default of `true` means existing rows backfill to `true` (preserves today's behavior). Adjust if autogenerate produced something different.

**Step 3: Apply migration**

Run: `docker compose run --rm api alembic upgrade head`
Expected: migration applies cleanly.

**Step 4: Test the model**

Add `api/tests/test_resume_model.py::test_resume_one_line_per_bullet_default` — create a Resume in a test DB session without setting the flag, flush, assert `resume.one_line_per_bullet is False` (Python-side default for new rows). Also test that loading an existing row via raw SQL `INSERT INTO resumes (..., one_line_per_bullet not specified)` results in `True` (server default).

Run: `docker compose run --rm api pytest api/tests/test_resume_model.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add api/app/models.py api/alembic/versions/
git add api/tests/test_resume_model.py
git commit -m "feat(api): add Resume.one_line_per_bullet flag"
```

---

## Task 2: Plumb `inject_wrap_shim` through compile_latex

**Files:**
- Modify: `api/app/services/compile.py:174-213`
- Modify/add: `api/tests/test_compile.py`

**Step 1: Failing test**

In `api/tests/test_compile.py`, add `test_compile_skips_wrap_shim_when_disabled`:

```python
def test_compile_skips_wrap_shim_when_disabled(monkeypatch):
    captured = {}
    real_run = subprocess.run

    def fake_run(cmd, *args, **kwargs):
        # cmd[-1] is the path to doc.tex
        captured["tex"] = Path(cmd[-1]).read_text()
        return real_run(cmd, *args, **kwargs)

    monkeypatch.setattr("app.services.compile.subprocess.run", fake_run)
    source = r"\documentclass{article}\begin{document}hello\end{document}"
    compile_latex(source, inject_wrap_shim=False)
    assert "HS_WRAP" not in captured["tex"]
    assert r"\hsMeasureLine" not in captured["tex"]
```

Add a companion `test_compile_injects_wrap_shim_by_default` that asserts `HS_WRAP` or `\hsMeasureLine` IS present when the kwarg is omitted.

Run: `docker compose run --rm api pytest api/tests/test_compile.py::test_compile_skips_wrap_shim_when_disabled -v`
Expected: FAIL (unexpected kwarg).

**Step 2: Implement**

Update `_inject_shim` to take `inject_wrap_shim: bool` and only concat `WRAP_SHIM` when true. Update `compile_latex(source, timeout=30, inject_wrap_shim=True)` signature; pass through to `_inject_shim`.

**Step 3: Verify**

Run: `docker compose run --rm api pytest api/tests/test_compile.py -v`
Expected: PASS, no existing tests regress.

**Step 4: Commit**

```bash
git add api/app/services/compile.py api/tests/test_compile.py
git commit -m "feat(api): make wrap-detection shim injection optional"
```

---

## Task 3: Plumb `detect_wraps` through enforce_one_page

**Files:**
- Modify: `api/app/services/enforcer.py:57-...` (signature + the one `compile_latex` call)
- Modify: `api/tests/test_enforcer.py`

**Step 1: Failing tests**

Add to `api/tests/test_enforcer.py`:

1. `test_enforce_passes_detect_wraps_false_to_compile` — monkeypatch `compile_latex` to capture kwargs; call `await enforce_one_page(candidate_latex="...", protected_terms=[], detect_wraps=False, max_iterations=0)`; assert `inject_wrap_shim=False` was passed.
2. `test_enforce_defaults_detect_wraps_true` — same setup, default call; assert `inject_wrap_shim=True`.
3. `test_enforce_ignores_wrap_hints_when_disabled` — monkeypatch compile to return `page_count=1` and one wrap-style `OverflowHint` with `snippet="wrap text"`; with `detect_wraps=False`, the loop should still treat the result as clean (the hint is treated as benign because the shim is off — note: in practice the shim being off means no wrap hints appear at all; this test pins the contract that the caller is responsible).

Actually simpler: only tests 1 and 2 are necessary. The "ignores wrap hints" behavior is a property of `compile_latex` not emitting them; `_is_clean` doesn't need to change.

Run: `docker compose run --rm api pytest api/tests/test_enforcer.py -v`
Expected: tests 1 and 2 FAIL (unexpected kwarg).

**Step 2: Implement**

Add `detect_wraps: bool = True` to `enforce_one_page`. In the initial compile and in each loop iteration's recompile (find all `compile_latex(...)` and `asyncio.to_thread(compile_latex, ...)` calls inside `enforcer.py`), pass `inject_wrap_shim=detect_wraps`.

**Step 3: Verify**

Run: `docker compose run --rm api pytest api/tests/test_enforcer.py -v`
Expected: PASS.

**Step 4: Commit**

```bash
git add api/app/services/enforcer.py api/tests/test_enforcer.py
git commit -m "feat(api): add detect_wraps toggle to enforce_one_page"
```

---

## Task 4: Add flag to Pydantic schemas

**Files:**
- Modify: `api/app/schemas/__init__.py:6-22, 58-65, 77-86`

**Step 1: Schema diff**

- `ResumeCreate`: add `one_line_per_bullet: bool = False`.
- `OnboardTexRequest`: add `one_line_per_bullet: bool = False`.
- `TailorRequest`: add `one_line_per_bullet: bool | None = None` (None = inherit from master).
- `ResumeOut`: add `one_line_per_bullet: bool`.
- `OnboardedResumeOut`: inherits, no change needed (gets it from `ResumeOut`).

**Step 2: Test**

Add `api/tests/test_schemas.py::test_resume_create_flag_default` etc. — simple Pydantic round-trip tests verifying defaults.

Run: `docker compose run --rm api pytest api/tests/test_schemas.py -v`
Expected: PASS.

**Step 3: Commit**

```bash
git add api/app/schemas/__init__.py api/tests/test_schemas.py
git commit -m "feat(api): add one_line_per_bullet to resume request/response schemas"
```

---

## Task 5: Wire `create_resume` to persist the flag

**Files:**
- Modify: `api/app/routes/resumes.py:42-52`
- Modify/add: `api/tests/test_routes_resumes.py` (or wherever resume create is tested)

**Step 1: Find existing tests**

Run: `grep -rn "def test.*create_resume\|/resumes.*post" api/tests/ | head`
Identify the file. Add a new test there.

**Step 2: Failing test**

`test_create_resume_persists_one_line_flag` — POST `/resumes` with body `{name, template_id, one_line_per_bullet: true}`; assert response includes `one_line_per_bullet=true` and DB row has it.

Also: `test_create_resume_defaults_one_line_false` — POST without the field; response/DB has `False`.

Run those tests. Expected: FAIL.

**Step 3: Implement**

Update `create_resume` to pass `one_line_per_bullet=body.one_line_per_bullet` when constructing the `Resume`.

**Step 4: Verify + commit**

```bash
docker compose run --rm api pytest <test path> -v
git add api/app/routes/resumes.py api/tests/...
git commit -m "feat(api): persist one_line_per_bullet on resume create"
```

---

## Task 6: Wire `onboard_tex` + `onboard_pdf` + `onboard.py` service

**Files:**
- Modify: `api/app/services/onboard.py` (both functions accept `one_line_per_bullet: bool`, pass to enforcer as `detect_wraps`)
- Modify: `api/app/routes/resumes.py:98-179` (both endpoints accept the flag and persist)
- Modify: `api/tests/test_onboard*.py` (find existing)

**Step 1: Update service**

Both `onboard_from_pdf` and `onboard_from_latex` gain `one_line_per_bullet: bool = False` kwarg; forward as `detect_wraps=one_line_per_bullet` to `enforce_one_page`. Return-type `OnboardResult` does NOT need the flag (the route persists it on the Resume row).

**Step 2: Update routes**

- `onboard_tex`: read `body.one_line_per_bullet`, pass to `onboard_from_latex(latex=..., one_line_per_bullet=...)`, set `resume.one_line_per_bullet=...` when constructing the Resume.
- `onboard_pdf`: add a new `Form` field `one_line_per_bullet: bool = Form(False)`; pass through similarly.

**Step 3: Tests**

- `test_onboard_tex_with_flag_true_runs_wrap_detection` — monkeypatch `enforce_one_page` to capture kwargs; assert `detect_wraps=True` when flag is set.
- `test_onboard_tex_default_flag_false_skips_wrap_detection` — assert `detect_wraps=False` when flag omitted.
- Same pair for `onboard_pdf` using `multipart/form-data` payload with the form field.
- Assert the persisted `Resume.one_line_per_bullet` matches in each case.

**Step 4: Run + commit**

```bash
docker compose run --rm api pytest api/tests/ -k onboard -v
git add api/app/services/onboard.py api/app/routes/resumes.py api/tests/...
git commit -m "feat(api): thread one_line_per_bullet through onboard flows"
```

---

## Task 7: Wire tailor pipeline (route + tailor service + jobs_runner)

**Files:**
- Modify: `api/app/services/tailor.py:66-129` (accept `one_line_per_bullet: bool = False` kwarg; pass to enforcer as `detect_wraps`)
- Modify: `api/app/services/jobs_runner.py:156-260` (load master flag; resolve effective flag; persist on variant)
- Modify: `api/app/routes/resumes.py:537-636` (write `one_line_per_bullet` into `job.payload`)
- Modify: `api/app/services/tailor_for_application.py` (if it also runs the enforcer, plumb the flag from master)

**Step 1: Tailor service**

`tailor_resume(..., one_line_per_bullet: bool = False, ...)` → pass `detect_wraps=one_line_per_bullet` to `enforce_one_page`.

**Step 2: jobs_runner.run_tailor_job**

- When loading the master, also read `master.one_line_per_bullet`.
- Effective flag: `payload.get("one_line_per_bullet")` if not None, else `master.one_line_per_bullet`. Store as a local.
- Pass to `tailor_resume(one_line_per_bullet=effective)`.
- When constructing the variant `Resume`, set `one_line_per_bullet=effective`.

**Step 3: Route**

In `tailor_endpoint`, when building the `Job.payload`, include `"one_line_per_bullet": body.one_line_per_bullet` (which is `bool | None`; JSON-null is preserved).

**Step 4: tailor_for_application**

Check whether `tailor_for_application.py` calls `enforce_one_page` or `tailor_resume`. If so, inherit from the master Resume and persist on the produced variant. If it doesn't run the enforcer, no change.

Run: `grep -n "enforce_one_page\|tailor_resume" api/app/services/tailor_for_application.py`. Apply changes as needed.

**Step 5: Tests**

- `test_tailor_inherits_master_flag` — master has flag=true, request body has it as None; variant ends up true and `tailor_resume` got `one_line_per_bullet=True`.
- `test_tailor_request_overrides_master` — master flag=true, request body has it as false; variant ends up false.
- `test_tailor_explicit_true_with_master_false` — symmetric override the other way.

These tests likely live alongside the existing tailor route/job tests. Use `JOBS_INLINE=1` to run the runner synchronously (existing tests should do this already).

**Step 6: Run + commit**

```bash
docker compose run --rm -e JOBS_INLINE=1 api pytest api/tests/ -k tailor -v
git add api/app/services/tailor.py api/app/services/jobs_runner.py api/app/routes/resumes.py api/app/services/tailor_for_application.py api/tests/
git commit -m "feat(api): thread one_line_per_bullet through tailor pipeline"
```

---

## Task 8: Wire `repair_resume` to honor the flag

**Files:**
- Modify: `api/app/routes/resumes.py:296-327`
- Modify: existing repair tests

**Step 1: Failing test**

`test_repair_skips_wrap_detection_when_flag_off` — create a Resume with `one_line_per_bullet=False`; monkeypatch `enforce_one_page` to capture kwargs; POST `/resumes/{id}/repair`; assert `detect_wraps=False`.

Plus `test_repair_runs_wrap_detection_when_flag_on`.

Expected: FAIL.

**Step 2: Implement**

In `repair_resume`, pass `detect_wraps=r.one_line_per_bullet` to `enforce_one_page`.

**Step 3: Verify + commit**

```bash
docker compose run --rm api pytest api/tests/ -k repair -v
git add api/app/routes/resumes.py api/tests/
git commit -m "feat(api): repair endpoint honors one_line_per_bullet flag"
```

---

## Task 9: New endpoint `POST /resumes/{id}/enforce_one_line`

**Files:**
- Modify: `api/app/routes/resumes.py` (add new route near `repair_resume`)
- Modify: `api/app/schemas/__init__.py` (optional response shape; can reuse `ResumeOut`)
- Add: tests in the routes test file

**Step 1: Failing tests**

Add tests:

1. `test_enforce_one_line_creates_sibling_resume` — Resume A with `one_line_per_bullet=False`; POST `/resumes/A/enforce_one_line`; response is a NEW resume B with `parent_id=A.id`, `kind=A.kind`, `template_id=A.template_id`, `name=f"{A.name} (one-line)"`, `one_line_per_bullet=True`. A is unchanged.
2. `test_enforce_one_line_preserves_jd_link_on_variant` — A is a variant with `job_description_id` set; B inherits it.
3. `test_enforce_one_line_404_on_other_user` — Resume owned by user_id != current returns 404.
4. `test_enforce_one_line_runs_with_detect_wraps_true` — monkeypatch `enforce_one_page` to capture kwargs; assert `detect_wraps=True`.

Expected: FAIL (endpoint doesn't exist).

**Step 2: Implement**

```python
@router.post("/{resume_id}/enforce_one_line", response_model=ResumeOut, status_code=201)
async def enforce_one_line(
    resume_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    src = await db.get(Resume, resume_id)
    if src is None or src.user_id != user_id:
        raise HTTPException(404)
    protected = resolve_protected_terms(user_pinned=src.protected_terms or [])
    try:
        result = await enforce_one_page(
            candidate_latex=src.latex_source,
            protected_terms=protected,
            detect_wraps=True,
        )
    except CompileError as e:
        raise HTTPException(422, detail={"error": "compile_failed", "log": str(e)[:4000]})
    sibling = Resume(
        user_id=user_id,
        parent_id=src.id,
        job_description_id=src.job_description_id,
        kind=src.kind,
        name=f"{src.name} (one-line)",
        template_id=src.template_id,
        latex_source=result.latex,
        content_json=src.content_json,
        protected_terms=list(src.protected_terms or []),
        one_line_per_bullet=True,
    )
    db.add(sibling)
    await db.flush()
    await snapshot_resume_version(
        db=db,
        resume=sibling,
        page_count=result.page_count,
        edit_source="enforce_one_line",
        edit_prompt=None,
        pdf_bytes=result.pdf,
    )
    await db.commit()
    await db.refresh(sibling)
    return sibling
```

Caveat for `kind`: if the source is a `master`, the new row's `parent_id` would point to another master, breaking the "master has parent_id=null" assumption used by `/resumes/grouped`. Decision: when `src.kind == "master"`, set `kind="master"` and `parent_id=None` on the sibling (it's an independent master); when `src.kind == "variant"`, preserve `parent_id=src.parent_id` (sibling sits under the same master, not under the source variant), and preserve `job_description_id`.

Update the implementation and tests to reflect this. Add a fifth test:

5. `test_enforce_one_line_on_master_creates_independent_master` — source is master; sibling has `kind="master"`, `parent_id=None`.

**Step 3: Verify + commit**

```bash
docker compose run --rm api pytest api/tests/ -k enforce_one_line -v
git add api/app/routes/resumes.py api/tests/
git commit -m "feat(api): POST /resumes/{id}/enforce_one_line creates one-line sibling"
```

---

## Task 10: Frontend API client

**Files:**
- Modify: `web/src/api.ts`

**Step 1: Update signatures**

- `createResume(name, template_id, oneLinePerBullet?: boolean)` → POST body includes the flag.
- `onboardTex(name, latex_source, oneLinePerBullet?: boolean)` → ditto.
- `onboardPdf(name, file, oneLinePerBullet?: boolean)` → FormData append.
- `tailor(...)` → add `one_line_per_bullet?: boolean | null` to request body.
- Add `enforceOneLine(id: number): Promise<ResumeOut>` calling `POST /resumes/${id}/enforce_one_line`.
- `Resume` / `OnboardedResume` / `Variant` response types gain `one_line_per_bullet: boolean`.

**Step 2: Tests**

Update or add Vitest tests for the API client touching each signature change.

Run: `docker compose run --rm web npm test -- --run web/src/api.test.ts` (or wherever it lives).

**Step 3: Commit**

```bash
git add web/src/api.ts web/src/...
git commit -m "feat(web): add one_line_per_bullet to resume API client"
```

---

## Task 11: Frontend dialogs — checkboxes for create/onboard/tailor

**Files:**
- Modify: `web/src/routes/ResumeList.tsx` (create resume dialog)
- Modify: `web/src/routes/Onboarding.tsx` (tex + pdf onboard)
- Modify: `web/src/components/TailorModal.tsx`

**Step 1: Add checkbox to each dialog**

Labeled "Enforce one line per bullet". Default to **off** for create/onboard. For tailor, prefill from the master resume's `one_line_per_bullet` (passed in as a prop from the caller).

Pass the value through to the corresponding API client call.

**Step 2: Update tests**

For each dialog's existing test file, add:
- Renders the checkbox, default unchecked (create/onboard) or prefilled (tailor).
- Submitting with checkbox checked sends `one_line_per_bullet=true` in the API call (mock the client and assert).

Run: `docker compose run --rm web npm test -- --run`
Expected: PASS.

**Step 3: Commit**

```bash
git add web/src/routes/ResumeList.tsx web/src/routes/Onboarding.tsx web/src/components/TailorModal.tsx web/src/...
git commit -m "feat(web): one-line-per-bullet checkbox in create/onboard/tailor dialogs"
```

---

## Task 12: Frontend — "Enforce one-line" button on the editor

**Files:**
- Modify: the resume editor route (find via `grep -rn "repair\|/repair" web/src` to locate where the repair button lives — the new button sits next to it)

**Step 1: Find the host component**

Run: `grep -rn "Repair\|/repair" web/src/`

**Step 2: Add the button**

"Enforce one-line per bullet → save as new". On click:
- Confirm dialog (single line: "This will create a new resume with one-line-per-bullet enforced.")
- Call `enforceOneLine(currentResumeId)`.
- On success: navigate to `/resumes/${response.id}` (use whatever the existing duplicate flow uses).

**Step 3: Tests**

Update the editor component's test file:
- Renders the new button.
- Click → calls `enforceOneLine` → navigates to the new resume.

Run: `docker compose run --rm web npm test -- --run`
Expected: PASS.

**Step 4: Commit**

```bash
git add web/src/...
git commit -m "feat(web): enforce-one-line button on resume editor"
```

---

## Task 13: Smoke test the full flow end-to-end

**Step 1: Bring up the stack**

Run: `docker compose up --build` and wait for services to be ready.

**Step 2: Manually verify**

- Create a new resume from template with the checkbox unchecked → DB row has `one_line_per_bullet=false`; compile path does not inject the wrap shim (check log or compile output).
- Onboard tex with checkbox checked → wrap detection runs.
- Tailor a resume; toggle the checkbox both ways → variant inherits the chosen value.
- Click "Enforce one-line per bullet" on an existing resume with flag off → new sibling created with flag on, original unchanged.

**Step 3: Final commit (only if any docs/comments need touch-up)**

Otherwise no commit. Plan complete.

---

## Verification checklist (before merge)

- [ ] Alembic migration applies cleanly on a fresh DB and on a DB with existing resumes.
- [ ] `docker compose run --rm api pytest` — full backend suite green.
- [ ] `docker compose run --rm web npm test -- --run` — full frontend suite green.
- [ ] Manual: each of the 4 flows (create, onboard tex, onboard pdf, tailor) round-trips the flag.
- [ ] Manual: `POST /resumes/{id}/enforce_one_line` produces a new sibling and leaves the source untouched.
- [ ] Page-count enforcement still runs in all cases (confirm with a deliberately long resume + flag=false: page-count repair still kicks in, wrap repair does not).
