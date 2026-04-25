# Phase 5 — Version History + Rollback

> **For Claude:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.

**Goal:** Every successful edit (AI accept, manual save, section save, tailor) snapshots a `resume_versions` row. User can list versions and roll back. Linear history per resume — no branching.

**Anchor:** design doc §4 + data model sketch.

**Scope:**
- New `resume_versions` table (id, resume_id, latex_source, content_json, page_count, edit_source, edit_prompt, created_at).
- Snapshot helper called by all four mutation paths.
- List + get + rollback endpoints.
- Frontend: VersionHistory panel + rollback button.

**Out of scope:** PDF artifact storage in MinIO (Phase 6); branching history.

---

## Task 1: Model + migration

**Files:** `api/app/models.py`, `api/alembic/versions/0004_resume_versions.py`, `api/tests/test_version_model.py`.

`ResumeVersion`: `id pk`, `resume_id int FK resumes.id`, `latex_source text`, `content_json jsonb default {}`, `page_count int`, `edit_source str(32)` (one of `manual`, `ai_chat`, `ai_tailor`, `section_form`, `onboard`), `edit_prompt text nullable` (the user instruction or short summary), `created_at timestamptz default now()`.

Index: `(resume_id, created_at desc)` for fast list.

Test: insert two versions, query ordered.

**Commit:** `feat(api): resume_versions table`

---

## Task 2: Snapshot helper

**Files:** `api/app/services/versioning.py`, `api/tests/test_versioning.py`.

```python
async def snapshot_resume_version(*, db, resume, page_count: int, edit_source: str, edit_prompt: str | None = None) -> ResumeVersion: ...
```

Pulls `latex_source` and `content_json` from the live `resume` row and inserts a new `ResumeVersion`. Caller must `await db.commit()`.

Tests assert payload shape + ordering.

**Commit:** `feat(api): version snapshot helper`

---

## Task 3: Wire snapshots into mutation endpoints

**Files:** `api/app/routes/resumes.py` — 4 callsites:
- `PUT /resumes/{id}` (raw LaTeX save) → `edit_source="manual"`, prompt=None.
- `POST /resumes/{id}/edits/accept` → `edit_source="ai_chat"`, prompt=None (could be improved by carrying the original instruction; defer).
- `PUT /resumes/{id}/sections` → `edit_source="section_form"`.
- `POST /resumes/{master_id}/tailor` (creates a NEW variant, not mutating an existing row) → snapshot the variant immediately on creation with `edit_source="ai_tailor"`, `edit_prompt=f"{title} @ {company}"`.
- `POST /resumes/onboard/tex` and `/onboard/pdf` → snapshot newly created master with `edit_source="onboard"`.

Snapshot uses the post-write state. Page count: re-use the value already computed by the endpoint (compile happens prior to commit in most paths). For paths that don't have a page_count handy (manual `PUT /resumes/{id}` doesn't compile), use `0` as "unknown".

**Commit:** `feat(api): snapshot every accepted edit`

---

## Task 4: Versions endpoints

**Files:** `api/app/routes/versions.py`, `api/tests/test_versions.py`.

- `GET /resumes/{id}/versions` → list (id, edit_source, edit_prompt, page_count, created_at).
- `GET /resumes/{id}/versions/{version_id}` → full detail incl. latex_source and content_json.
- `POST /resumes/{id}/versions/{version_id}/rollback` → copies version's `latex_source` + `content_json` back onto the live resume; ALSO snapshots the new state with `edit_source="rollback"`, `edit_prompt=f"to v{version_id}"`. Returns ResumeOut.

Wire `app.routes.versions.router` into `main.py`.

**Commit:** `feat(api): version list/get/rollback endpoints`

---

## Task 5: Frontend api client

**Files:** modify `web/src/api.ts`. Add `listVersions(id)`, `getVersion(id, vid)`, `rollback(id, vid)`.

**Commit:** `feat(web): api client versions`

---

## Task 6: VersionHistory component

**Files:** `web/src/components/VersionHistory.tsx`, test file.

Renders a vertical list of versions for a resume. Each row: `{edit_source} • {created_at}` plus a "Rollback" button. Clicking rollback calls `api.rollback`, then `onRolledBack(updatedResume)` so parent can refresh.

**Commit:** `feat(web): VersionHistory component`

---

## Task 7: Editor wiring

**Files:** modify `web/src/routes/Editor.tsx`. Add a 4th tab/pill in the LEFT pane button row: "History". When active, the LEFT pane renders VersionHistory; selecting a version calls rollback → `setLatex` from response → recompile.

Alternatively (simpler): add a small "History" button that toggles a panel above the editor. Pick whichever is least invasive.

**Commit:** `feat(web): wire VersionHistory in editor`

---

## Task 8: E2E

**Files:** `web/e2e/versions.spec.ts`. Stub list + rollback. Verify list renders + rollback button triggers POST.

**Commit:** `test(web): versions e2e`

---

## Done criteria

- API: 93 + ~10 new pass.
- Vitest: 25 + ~3 new pass.
- Playwright: 5 + 1 new pass.
- User can see a list of past versions and roll back to any of them.
