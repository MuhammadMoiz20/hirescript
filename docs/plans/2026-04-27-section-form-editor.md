# Phase 3 — Section Form Editor + LaTeX↔JSON Parser

> **For Claude:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.

**Goal:** Default editing view is a structured section form (Education, Experience, Projects, Skills) with a toggle to drop into raw LaTeX. Two-way sync is feasible because we control the template structure.

**Anchor:** design doc §3 "Manual edit", and `templates.section_schema_json` slot in the data model sketch.

**Scope (Phase 3):**
- Single template: `jakes`. Other templates follow the same pattern when added.
- LaTeX → JSON parser, JSON → LaTeX renderer, round-trip safe for Jake's preamble untouched.
- New endpoint surface for sections; persists `content_json` alongside `latex_source`.
- Form-editor UI; LaTeX toggle preserved; the AI/diff/preview flows from Phases 1–2 keep working.

**Out of scope:** Other templates, AI-assisted form-editing helpers, PDF onboarding, version history.

---

## Task 1: Jake's section schema

**Files:**
- Create: `api/app/templates/jakes_schema.py`

`jakes_schema.SECTION_SCHEMA`: ordered list of typed sections matching what's in `jakes_skeleton.tex`.

```python
SECTIONS = [
  {"id": "header", "type": "header", "fields": ["name","tagline","contacts"]},
  {"id": "education", "type": "list_subheading"},
  {"id": "experience", "type": "list_subheading"},
  {"id": "projects", "type": "list_project"},
  {"id": "skills", "type": "key_value_list"},
]
```

Plus per-row schemas. Concrete in code, not freeform.

Add `template_id="jakes"` registry export `get_section_schema("jakes")`.

**Commit:** `feat(api): jakes section schema`

---

## Task 2: LaTeX → JSON parser

**Files:**
- Create: `api/app/services/parser_jakes.py`
- Create: `api/tests/test_parser_jakes.py`

`parse_jakes(latex: str) -> dict` returns content_json:
```json
{
  "header": {"name":"...","tagline":"...","contacts":[{"label":"phone","value":"..."},...]},
  "education": [{"institution":"Dartmouth","location":"Hanover, NH","degree":"B.S....","date":"Exp. Aug 2026","bullets":["...","..."]}, ...],
  "experience": [{...same shape with title/company/location/date/bullets}, ...],
  "projects": [{"name":"Classmoji","tech":"TS, React, ...","bullets":[...]}, ...],
  "skills": {"Languages":"Python, ...","Infrastructure":"AWS ..."}
}
```

Implementation: line-walk the source, recognise section markers (`\section{...}` blocks) and the custom commands (`\resumeSubheading`, `\resumeProjectHeading`, `\resumeItem`), extract group args.

Handle `\textbf{...}` and `\href{url}{text}` in bullets by stripping commands but keeping inner text — but ONLY for parsing; the round-trip test allows the renderer to put them back. Decision: store the LaTeX-as-written for bullets (with `\textbf{}` etc preserved). Frontend can render LaTeX-source-as-rich-text or just display text with markers; v1 keeps it as raw LaTeX strings.

**Commit:** `feat(api): jakes LaTeX → JSON parser`

---

## Task 3: JSON → LaTeX renderer

**Files:**
- Create: `api/app/services/renderer_jakes.py`
- Create: `api/tests/test_renderer_jakes.py`
- Create: `api/app/templates/jakes_preamble.tex` (extracted preamble from existing skeleton)

The renderer composes:
```
<preamble>
\begin{document}
<header>
<sections>
\end{document}
```

`render_jakes(content_json) -> str` — outputs LaTeX using the same custom commands.

The preamble is captured verbatim from the seeded `jakes_skeleton.tex` (everything before `\begin{document}`). Storing it separately keeps the renderer clean.

**Commit:** `feat(api): jakes JSON → LaTeX renderer`

---

## Task 4: Round-trip golden test

**Files:**
- Create: `api/tests/test_jakes_roundtrip.py`

Parse the seeded `jakes_skeleton.tex` → get json → render back to LaTeX → compile both with Tectonic → assert PDFs are byte-equal-ish (or at least equal page count and equal byte count within ±5%). Strict equality is unrealistic across LaTeX runs; compare:
- `compile_latex(orig).page_count == compile_latex(rendered).page_count == 1`
- `len(json) > 0` for each section (sanity).
- Re-parse the rendered LaTeX and assert deep-equal to first parse (parse-render-parse stability).

**Commit:** `test(api): jakes round-trip parser/renderer`

---

## Task 5: Resume sections endpoints

**Files:**
- Modify: `api/app/routes/resumes.py`
- Modify: `api/app/schemas.py`
- Create: `api/tests/test_sections.py`

`GET /resumes/{id}/sections` — parses `latex_source` if `content_json` is null/empty; otherwise returns stored `content_json`.

`PUT /resumes/{id}/sections` — body `{content_json: dict}`. Renders to LaTeX, validates compile + page count, stores both `latex_source` and `content_json`.

Reject with 422 on compile failure or `page_count != 1`.

**Commit:** `feat(api): section read/write endpoints`

---

## Task 6: Frontend api client

**Files:**
- Modify: `web/src/api.ts`

Add `getSections(id)`, `putSections(id, content_json)`.

**Commit:** `feat(web): api client section get/put`

---

## Task 7: SectionFormEditor component

**Files:**
- Create: `web/src/components/SectionFormEditor.tsx`
- Create: `web/src/components/SectionFormEditor.test.tsx`

Renders dynamic forms per section: header form, list-of-subheading sections (Education, Experience), list-of-projects, key-value skill groups.

Each list section supports add / remove / reorder rows. Each row supports add/remove bullets. Inputs are text fields; bullets are textareas (LaTeX-allowed).

Save button → `putSections`; surfaces compile/page errors inline.

**Commit:** `feat(web): SectionFormEditor component`

---

## Task 8: Editor view-mode toggle

**Files:**
- Modify: `web/src/routes/Editor.tsx`

Add a pill toggle "Form / LaTeX" at top. Form mode renders `SectionFormEditor`; LaTeX mode keeps current CodeMirror.

When the user toggles from LaTeX → Form, fetch `/sections` (which auto-parses if needed). When toggling Form → LaTeX, the next render of LaTeX uses the latest stored `latex_source` (the form save endpoint persists it).

**Commit:** `feat(web): form/latex toggle in editor`

---

## Task 9: E2E smoke

**Files:**
- Create: `web/e2e/sections.spec.ts`

Stub: load grouped, open master, toggle to Form, edit a bullet, save → verify network call shape, no crash. (Don't assert PDF content — the compile/render is exercised by backend tests.)

**Commit:** `test(web): section form e2e`

---

## Done criteria

- API: 63 + ~13 new tests pass.
- Vitest: 17 + ~3 new pass.
- Playwright: 3 + 1 new pass.
- Editor opens to the form view by default after this phase ships (configurable via toggle).

Next plan: `2026-04-XX-pdf-onboarding.md`.
