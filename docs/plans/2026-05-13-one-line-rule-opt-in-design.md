# One-Line-Per-Bullet Rule: Opt-In — Design

Date: 2026-05-13
Status: Approved, ready for implementation plan.

## Problem

Wrap-aware enforcement (`docs/plans/2026-04-27-wrap-aware-enforcement-design.md`)
makes "every bullet fits on one visual line" a hard rule, applied uniformly to
every resume the system produces. Users want flexibility: some resumes should
tolerate bullets that wrap to two visual lines, and the rule should be a
per-resume choice made at the moment a resume enters the system (create,
onboard, or tailor) rather than a system-wide invariant.

The strict "exactly one PDF page" rule remains non-negotiable.

## Goal

Make wrap detection a per-resume opt-in flag, configurable at every entry
point that produces a resume, plus a post-hoc action that produces a new
one-line-enforced sibling resume without modifying the original.

## Non-goals

- Changing the one-PDF-page rule.
- Per-bullet overrides — the flag is whole-resume.
- AI repair prompt changes — `repair_overflow` already handles either hint
  shape.
- UI badge in resume lists (deferrable; lineage via `parent_id` is enough).

## Architecture

### Data model

`Resume` gains:

```python
one_line_per_bullet: Mapped[bool] = mapped_column(
    Boolean, nullable=False, server_default=text("true")
)
```

Alembic migration backfills existing rows to `true` (preserves today's
behavior). The Python-side default for newly constructed rows is `False` so
that new resumes start lax unless the request opts in.

### Enforcer

`compile_latex` gains `inject_wrap_shim: bool = True`. When `False`, the
`latex_shim` is not injected; no `HS_WRAP:` lines appear in the log;
`parse_overflows` naturally returns only `Overfull \hbox` hints.

`enforce_one_page` gains `detect_wraps: bool = True`, plumbed to
`compile_latex(inject_wrap_shim=detect_wraps)`. `_is_clean` is unchanged —
when wraps are disabled the `overflows` tuple simply contains no wrap hints,
so the loop reacts only to hbox warnings and page count.

### Call sites

Every place that calls `enforce_one_page` reads the resume's flag (or the
request body's override) and passes it through:

- `routes/resumes.py:create_resume` — request schema `ResumeCreate` gains
  `one_line_per_bullet: bool = False`; persisted on the new row.
- `routes/resumes.py:onboard_tex` and `onboard_pdf` — `OnboardTexIn` /
  `OnboardPdfIn` gain the same field; passed to `services/onboard.py`, which
  forwards to `enforce_one_page` and persists the flag.
- `routes/resumes.py:tailor_endpoint` — `TailorIn` gains an optional
  `one_line_per_bullet: bool | None`. If `None`, inherit from the master; if
  set, the request value wins. Persisted on the variant.
- `routes/resumes.py:repair_resume` — reads `resume.one_line_per_bullet`,
  honors it (no request override needed).
- `routes/resumes.py:compile_resume` — reads the flag the same way.

### Post-hoc convert endpoint

New: `POST /resumes/{id}/enforce_one_line` → `ResumeOut`.

- Loads the source resume (404 if missing or wrong user).
- Runs `enforce_one_page(candidate_latex=src.latex_source,
  protected_terms=src.protected_terms, detect_wraps=True)`.
- Creates a new `Resume`:
  - `parent_id = src.id`
  - `kind = src.kind`
  - `template_id = src.template_id`
  - `job_description_id = src.job_description_id`
  - `name = f"{src.name} (one-line)"`
  - `latex_source = result.latex`
  - `protected_terms = src.protected_terms`
  - `one_line_per_bullet = True`
- Returns the new resume serialized as `ResumeOut`.
- Original is never mutated.

### Frontend

- **Create / Onboard / Tailor dialogs**: a labeled checkbox
  "Enforce one line per bullet". Defaults to off for create and onboard;
  tailor prefills from the master and remains user-editable.
- **Resume editor**: button "Enforce one-line per bullet → save as new",
  visible on any resume regardless of current flag. Hits the new endpoint
  and navigates to the returned resume on success.
- A small inline label in the editor header indicates whether the rule is
  on or off for the currently open resume.

## Data flow (tailor with rule off)

```
TailorIn { one_line_per_bullet: false } (or master.flag == false)
  ▼
tailor service → candidate LaTeX
  ▼
enforce_one_page(detect_wraps=false)
  ▼
compile_latex(inject_wrap_shim=false)
  → no HS_WRAP lines in log
  → overflows only carry Overfull \hbox hints
  ▼
loop only fires on page_count > 1 or hbox warnings
  ▼
new variant Resume row persisted with one_line_per_bullet=false
```

## Error handling

| Failure | Behavior |
|---|---|
| Convert endpoint: source not found / wrong user | 404. |
| Convert endpoint: enforce_one_page fails to converge | Persist the new resume anyway with `enforced=False` log surfaced in response (same shape as today's repair endpoint), so the user sees the best attempt. |
| Tailor request with master flag false and explicit `one_line_per_bullet=true` | Tailor produces a variant with the rule on, including wrap repair during enforcement. |
| Existing resumes after migration | All have `one_line_per_bullet=true`; behavior unchanged from today. |

## Tests

Backend:

1. `enforce_one_page(detect_wraps=False)` does not inject shim, ignores
   simulated wrap-only overflow (compile_latex stubbed) and returns clean
   when page_count==1.
2. `enforce_one_page(detect_wraps=False)` still repairs an Overfull \hbox.
3. `POST /resumes` with `one_line_per_bullet=true` persists the flag.
4. `POST /resumes/onboard/tex` and `onboard/pdf` persist the flag.
5. `POST /resumes/{master_id}/tailor` inherits master flag when not provided;
   request value overrides when provided. Variant persists the resulting flag.
6. `POST /resumes/{id}/enforce_one_line` creates a child with `parent_id=src.id`,
   `one_line_per_bullet=true`, name suffixed, and original unchanged.
7. `POST /resumes/{id}/repair` honors `resume.one_line_per_bullet=false` (no
   wrap detection runs).
8. Alembic migration: existing rows backfill to `true`.

Frontend:

9. Create dialog round-trips the checkbox value.
10. Tailor dialog prefills the checkbox from the master resume.
11. Editor convert button calls the endpoint and navigates to the new resume.

## Risks

- **Behavior split confuses users.** Mitigation: editor header shows the
  rule state for the currently open resume.
- **Existing resumes silently use the strict rule forever.** Acceptable;
  users can convert or toggle by creating a new tailor.

## Out of scope

- Per-bullet overrides.
- AI prompt changes.
- Resume-list badge.
- Toggling the flag on an existing resume without recompiling (today the
  flag is read every compile, so toggling will just take effect on the next
  compile — but no UI affordance is included in this slice).
