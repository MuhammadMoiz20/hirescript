# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Start Here

HireScript is currently pre-code. The repo is mainly product/design planning under `docs/plans/`; the first real implementation should follow `docs/plans/2026-04-24-walking-skeleton.md`.

Before writing implementation code, read:

- `docs/plans/2026-04-24-walking-skeleton.md`
- `docs/plans/2026-04-24-resume-maker-design.md`
- `.claude/README.md`

Before frontend or UI work, also read `design/handoffs/hirescript/README.md` and inspect the files under `design/handoffs/hirescript/project/`.

When executing the walking-skeleton plan, use the `superpowers:executing-plans` skill. The plan explicitly requires it.

## Product Summary

HireScript is a single-tenant web app for maintaining a master LaTeX resume and generating job-tailored variants with Claude. AI is the primary editing interface; raw LaTeX editing is secondary.

The walking skeleton only builds this thin slice: login, create a resume from a built-in LaTeX template, edit raw LaTeX, compile with Tectonic, and preview the PDF. Do not add AI editing, variants, PDF upload, Marker onboarding, MinIO, or deployment work unless a later plan asks for it.

## Intended Architecture

Once scaffolded, the app has three Docker Compose services:

- `web`: React 18, Vite, TypeScript, CodeMirror 6, pdfjs-dist. Vite proxies `/api` to `http://api:8000`.
- `api`: FastAPI, SQLAlchemy 2.x async, asyncpg, Alembic, Pydantic v2. Tectonic is installed in the image and invoked with `subprocess`.
- `db`: Postgres 16.

Auth is deliberately single-tenant: one server-side `APP_PASSWORD`, signed `session` cookie via `itsdangerous`, and hardcoded `user_id = 1`. Do not introduce multi-user abstractions in Phase 1.

Compiled PDFs live in a local Docker volume during development. MinIO/S3 is for a later phase.

## Non-Negotiable Resume Rule

Every resume produced by the system must compile to exactly one PDF page.

This is an architectural invariant, not a cosmetic warning:

- `compile_latex()` returns a `CompileResult` that includes `pdf` bytes and `page_count`.
- Page count is derived from the compiled PDF, not guessed from text length.
- Preserve `page_count` across service, route, persistence, and UI boundaries.
- Never truncate, clip, hide overflow, or silently drop content to force one page.
- AI overflow repair must rewrite intelligently while preserving protected terms.
- Manual edits may show a blocking/advisory overflow state, but the app must not rewrite a human's LaTeX without an explicit action.

The walking skeleton reports page count. Later AI flows enforce page count through a `OnePageEnforcer` repair loop.

## AI Phase Rules

AI features are out of scope for the walking skeleton, but future work should follow these defaults:

- Haiku 4.5: chat edits, overflow repair iterations 1-2, JD keyword extraction.
- Sonnet 4.6: tailoring to a job description, overflow repair iteration 3+.
- Opus 4.7: opt-in only for "Deep tailor".
- All AI edits produce visible diffs and compile before acceptance.
- Protected terms are ATS verbs, JD keywords, and user-pinned terms; every repair prompt must preserve them.

## Development Workflow

Prefer the repo plans over assumptions. The walking skeleton is intentionally task-by-task and test-first.

Expected rhythm:

1. Read the relevant task in `docs/plans/2026-04-24-walking-skeleton.md`.
2. Write the failing test described by the task.
3. Implement only enough to pass that task.
4. Run the smallest relevant test command.
5. Commit with the conventional commit message specified by the plan.

Do not skip ahead by building later-phase features just because the architecture mentions them.

## Design Handoff

Two authoritative design sources for UI work, in priority order:

1. **HireScript Suite design bundle** — `https://api.anthropic.com/v1/design/h/eYoG49rlvB10YH7DYeCNgA`. Fetch the bundle, read `README.md` + `chats/chat1.md`, then read the relevant `*.jsx`/`*.css` files. The product is **one app: `HireScript Suite`** with two functional sections (Per-job and Mass-apply) under a unified top bar + left nav + ⌘K. The bundle's three HTML files are prototype iteration stages, not three apps to ship — production runs in one React SPA, no iframes.
2. **In-repo handoff** — `design/handoffs/hirescript/`. Continues to provide tokens for already-shipped components.

For frontend work:

- Fetch the bundle URL first, then read `design/handoffs/hirescript/README.md`.
- Treat both sources as the visual and interaction reference; if they conflict, the bundle wins for new surfaces and the in-repo handoff wins for already-shipped tokens (so existing components don't drift).
- Inspect the project files for screens, components, fixtures, and design tokens.
- Reuse the intent, layout, density, component hierarchy, typography, spacing, colors, and interaction patterns from the handoff.
- Translate the handoff into production React/TypeScript code; do not copy prototype-only structure if it conflicts with the app architecture.
- Keep implementation scoped to the current phase. If the handoff shows later-phase UI, preserve the design direction but do not wire unsupported behavior.
- If the plan and handoff conflict, follow the implementation plan for scope and the handoff for presentation. Call out meaningful conflicts before making broad changes.

## Commands

Before the walking skeleton exists, these commands will fail because the files/images do not exist yet.

```bash
docker compose up --build
docker compose run --rm api pytest
docker compose run --rm api pytest tests/test_foo.py -v
docker compose run --rm api alembic revision --autogenerate -m "msg"
docker compose run --rm api alembic upgrade head
docker compose run --rm web npm test -- --run
docker compose run --rm web npm run test:e2e
```

Use Docker Compose for dev/test commands once scaffolded. Avoid relying on host Python or Node versions unless the user explicitly asks.

## Code Standards

- Keep changes tightly scoped to the current task or user request.
- Prefer simple, explicit code over premature abstraction.
- Preserve async SQLAlchemy patterns in backend code.
- Keep API schemas typed with Pydantic v2.
- Keep frontend state local until a shared state problem actually appears.
- Treat LaTeX compile and page-count behavior as shared domain logic, not route-specific glue.
- Add tests for behavior, not implementation details.

## Claude Helpers

Project-specific Claude files live under `.claude/`:

- `.claude/README.md`: how to use the Claude helpers.
- `.claude/commands/execute-walking-skeleton.md`: task-by-task implementation workflow.
- `.claude/commands/start-task.md`: quick context-loading prompt for a new task.
- `.claude/commands/review-current-work.md`: review checklist before handoff.
- `.claude/agents/backend-api.md`: focused backend implementation/review guidance.
- `.claude/agents/frontend-web.md`: focused frontend implementation/review guidance.
- `.claude/agents/product-architect.md`: scope and architecture guardrails.
