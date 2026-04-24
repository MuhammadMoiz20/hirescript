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

Model default: Sonnet 4.6. An opt-in "Deep tailor" toggle uses Opus 4.7 for the JD preset.

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

Every generated LaTeX is compiled with Tectonic before being shown to the user. If compile fails, Claude is re-prompted with the error (max 2 retries) before surfacing a failure to the user.

## Error Handling

- **Tectonic compile failure** after AI edit → auto-retry with error context (≤2 times), then show the user the raw diff with an error banner and let them fix manually or discard.
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
