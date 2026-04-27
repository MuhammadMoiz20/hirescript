# Mass-Apply Slice 2.5 — Suite Design Pass

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Before any UI task, fetch the design bundle and read the referenced source files.

**Goal:** Apply the HireScript Suite design bundle (`https://api.anthropic.com/v1/design/h/eYoG49rlvB10YH7DYeCNgA`) to the existing app — a single unified Suite with two functional sections (Per-job and Mass-apply) under one top bar, one left nav, one ⌘K, one dark toggle. Refresh every existing surface to use the new tokens + primitives, and add the missing surfaces the design proposes (Dashboard, Tiers, Settings, History, Notifications). Backend is unchanged.

**Architecture:** Replace the current `Shell` chrome in `web/src/App.tsx` with the Suite shell (top bar + grouped left nav + Overview home + ⌘K palette + notifications drawer). Port `tokens.css` + `tokens-massapply.css` into `web/src/styles/`. Build the new design primitives (`TierBadge`, `FitChip`, `StatusPill`, `ModeToggle`, `MaxGauge`, `Sparkline`, `PageCountBadge`, `CompileChip`, `ProtectedTermPill`) as reusable components. Migrate every existing surface and add the new ones. No iframes — everything runs in the existing React SPA. No backend changes.

**Tech Stack:** React 18, TypeScript, Vite, plain `useState` + Context (no Zustand/Redux/router lib beyond what's already in use), CSS variables for tokens, system fonts as fallback for Source Serif / Inter / JetBrains Mono.

**Bundle source files** (extract `https://api.anthropic.com/v1/design/h/eYoG49rlvB10YH7DYeCNgA` to a tempdir; read top-to-bottom):

- `hirescript/README.md` + `hirescript/chats/chat1.md` — intent + design decisions.
- `hirescript/project/tokens.css` — base tokens (colors, type scale, spacing, radius).
- `hirescript/project/tokens-massapply.css` — mass-apply additions (tier hues, status pill shapes, mode toggle, max gauge).
- `hirescript/project/suite.css` — unified shell layout.
- `hirescript/project/ma-runtime.css` — mass-apply runtime styles.
- `hirescript/project/components.jsx` — per-job primitives (`PageCountBadge`, `CompileChip`, `ModelBadge`, `ProtectedTermPill`, top chrome).
- `hirescript/project/ma-primitives.jsx` — mass-apply primitives (`TierBadge`, `FitChip`, `StatusPill`, `ModeToggle`, `MaxGauge`, `Sparkline`).
- `hirescript/project/ma-shell.jsx` — top bar + nav rail + page wrapper.
- `hirescript/project/ma-screens-1.jsx` (Dashboard, Inbox, Queue, History), `ma-screens-2.jsx` (Knowledge tabs, Tiers, Settings), `ma-screens-3.jsx` (Notifications drawer, ⌘K palette, Component inventory, Microcopy).
- `hirescript/project/screens-a.jsx` + `screens-b.jsx` — per-job screens (Library, Editor, Diff, Tailor, History, JDs, Overflow).
- `hirescript/project/suite.jsx` — unified shell (the integration target).

**Repo state when starting:**

- Backend Slice 2 shipped on `main` (`a6e9fd3`): tests at 304/1.
- Frontend Slice 2 shipped on `main`: tests at 111 across 33 files.
- Existing surfaces (will be refreshed):
  - Per-job: `routes/ResumeList.tsx`, `routes/Editor.tsx`, the Tailor modal, version history component, JD parser surfaces, overflow banner.
  - Mass-apply (slices 1-2): `routes/Profile.tsx`, `routes/Knowledge.tsx`, `routes/OnboardingChat.tsx`, `routes/Inbox.tsx`, `routes/Applications.tsx`, `routes/Jobs.tsx` (existing tailor jobs queue — distinct from the new mass-apply queue).
  - Onboarding (resume LaTeX/PDF) at `routes/Onboarding.tsx`.
  - The current `Shell` chrome in `App.tsx` (button-row nav).
- Existing `design/handoffs/hirescript/` and the `web/src/components/ui/` primitives directory.

**Scope guardrails:**

- **No backend changes.** Every endpoint, schema, migration, and runner stays as-is. The redesign is purely frontend.
- **No iframes.** The bundle's `HireScript Suite.html` mounts the two sub-apps as iframes for prototype convenience; we integrate everything natively.
- **No new features beyond what the design depicts.** The design includes Dashboard / Tiers / Settings / mass-apply History / Notifications drawer / ⌘K — those are in scope. Anything beyond (live session viewer, A-mode UI) is Slice 3.
- **No `*.jsx` runtime copy-paste.** The bundle's React-via-CDN runtime is prototype-only. Recreate components in production TypeScript.
- **Existing surfaces stay functionally equivalent.** Refresh visuals + structure; do not change behaviors. Tests should keep passing with updated selectors as needed.

**Tests run via**: `cd web && npx vitest run` for unit/component tests; `npx playwright test` for E2E. Backend tests should not regress.

**Reference docs (read before starting):**
- The design bundle (URL above).
- `docs/plans/2026-04-26-mass-apply-design.md` — parent design, especially the new "Design source (all slices)" section.
- `CLAUDE.md` — Design Handoff section.

---

## Build sequencing

Six phases, each with several tasks. Phases run in order; tasks within a phase are mostly independent.

```
Phase A: Design system foundation        (Tasks 1–6)
Phase B: Suite shell                     (Tasks 7–11)
Phase C: Mass-apply surface refresh      (Tasks 12–16)
Phase D: Per-job surface refresh         (Tasks 17–20)
Phase E: New surfaces                    (Tasks 21–25)
Phase F: Polish + E2E                    (Tasks 26–28)
```

Each task: write/update component → migrate or add tests → commit. TDD where the surface has behavior; visual-only changes commit with a screenshot or static snapshot test.

---

## Phase A — Design system foundation

### Task 1: Port design tokens

**Files:**
- Create: `web/src/styles/tokens.css` — copy + adapt from `hirescript/project/tokens.css`. Variables: `--ink`, `--paper`, `--paper-warm`, `--accent` (terracotta), `--success`, `--error`, type scale, spacing, radius. Light + dark.
- Create: `web/src/styles/tokens-massapply.css` — copy + adapt from `hirescript/project/tokens-massapply.css`. Variables: `--tier-dream`, `--tier-targeted`, `--tier-wide`, `--tier-skip`, status-pill colors per state, mode-toggle shapes, max-gauge band stops.
- Create: `web/src/styles/suite.css` — copy + adapt from `hirescript/project/suite.css` and `ma-runtime.css`. Suite-level layout primitives.
- Modify: `web/src/main.tsx` (or wherever the entry CSS is imported) to load all three new files. Keep the existing `index.css` for now; deletion comes in Task 26 once nothing references it.

Tests: a small Vitest spec asserts `getComputedStyle(document.documentElement).getPropertyValue('--tier-dream')` returns a non-empty string after the entry CSS loads. (One test per token file is enough — confirms the CSS landed and variables are defined.)

**Commit:** `feat(web): port HireScript Suite design tokens`

### Task 2: Wire Source Serif + Inter + JetBrains Mono

**Files:**
- Modify: `web/index.html` — add `<link>` tags for Google Fonts (Source Serif 4, Inter variable, JetBrains Mono variable). Use `display=swap`.
- Modify: `web/src/styles/tokens.css` — define `--font-serif`, `--font-sans`, `--font-mono` and apply to `body`, headings, and `code`/`pre` selectors.

Test: a snapshot/visual test asserting `body { font-family }` resolves to a stack starting with `Inter`. Skipped under jsdom if measuring resolved fonts is unreliable.

**Commit:** `feat(web): font wiring for Source Serif + Inter + JetBrains Mono`

### Task 3: `PageCountBadge`, `CompileChip`, `ModelBadge`, `ProtectedTermPill`

**Files:**
- Create or modify: `web/src/components/ui/PageCountBadge.tsx` — 6 states per design (`ok`, `over`, `compiling`, `error`, `unknown`, `final`). Mono font, structural. Sized to fit top chrome / diff header / library row / version row.
- Create or modify: `web/src/components/ui/CompileChip.tsx` — compile-state pill (queued, compiling, ok, failed). Mono.
- Create or modify: `web/src/components/ui/ModelBadge.tsx` — Haiku / Sonnet / Opus chips.
- Create or modify: `web/src/components/ui/ProtectedTermPill.tsx` — protected-term token with optional remove button.
- Test: each component's existing test (where present) gets a screenshot snapshot or render-asserts-visible-states test.

Source-of-truth: bundle `hirescript/project/components.jsx`. Recreate visually; do not import the bundle's prototype runtime.

**Commit:** `feat(web): per-job design primitives (PageCountBadge etc.)`

### Task 4: `TierBadge`, `FitChip`, `StatusPill`

**Files:**
- Create: `web/src/components/ui/TierBadge.tsx` — accepts `tier: "dream" | "targeted" | "wide" | "skip"`. Hue per design (violet / blue / green / neutral). Compact + spacious sizes.
- Create: `web/src/components/ui/FitChip.tsx` — accepts `score: number | null` (0–100). Band logic: ≥85 strong, 60–84 moderate, 40–59 weak, <40 muted.
- Create: `web/src/components/ui/StatusPill.tsx` — outline + glyph + label, 11 states (per chat transcript: `queued`, `running`, `ok`, `failed`, `cancelled`, `paused`, `stuck`, `errored`, `prepared`, `submitted`, `duplicate_skipped`). Mono label.
- Test: `web/src/components/ui/TierBadge.test.tsx`, `FitChip.test.tsx`, `StatusPill.test.tsx` — render every variant, assert correct className/style applied.

Source: bundle `ma-primitives.jsx`.

**Commit:** `feat(web): mass-apply design primitives — tier, fit, status`

### Task 5: `ModeToggle`, `MaxGauge`, `Sparkline`

**Files:**
- Create: `web/src/components/ui/ModeToggle.tsx` — A/B pill. Filled side = active mode, font-weight = override state. Per-job-only OR globally-defaulting variants. Disabled (read-only) prop for B-mode-only contexts.
- Create: `web/src/components/ui/MaxGauge.tsx` — horizontal band gauge for "Max-window headroom." Accepts `usedPct: number` and `resetsAt: Date`. Compact (top-bar) + expanded (dashboard) sizes.
- Create: `web/src/components/ui/Sparkline.tsx` — 14-day applied-jobs sparkline. Pure SVG, no external lib.
- Tests: render variants and assert visible structure.

Source: bundle `ma-primitives.jsx`.

**Commit:** `feat(web): mass-apply design primitives — mode, gauge, sparkline`

### Task 6: Dark mode parity sweep

**Files:**
- Modify: `web/src/components/ThemeProvider.tsx` — verify light/dark hooks drive the new tokens correctly. Toggle should set `data-theme="dark"` on `documentElement`.
- Modify: each new primitive in Tasks 3–5 — ensure dark mode pair is deliberately designed (not auto-inverted) per the bundle.
- Test: a Playwright dark-mode visual test (or vitest + jsdom checking `data-theme` propagation) confirming each primitive renders without obvious failures in both modes.

**Commit:** `feat(web): dark mode parity for new primitives`

---

## Phase B — Suite shell

### Task 7: TopBar (logo + breadcrumb + Max gauge + theme + ⌘K + notifications)

**Files:**
- Create: `web/src/components/suite/TopBar.tsx` — left: HireScript wordmark (Source Serif). Center: breadcrumb of current section/route. Right: `MaxGauge` (compact), theme toggle, ⌘K trigger, notifications bell with unread count.
- Test: `TopBar.test.tsx` — renders, calls navigate on breadcrumb click, opens ⌘K on click + on `Cmd+K` keypress.

Source: bundle `ma-shell.jsx` + `suite.jsx`.

**Commit:** `feat(web): suite top bar with Max gauge + nav controls`

### Task 8: NavRail (grouped left nav)

**Files:**
- Create: `web/src/components/suite/NavRail.tsx` — collapsible left nav. Two groups:
  - **Per-job**: Library, Editor (when a resume is open), Diff, Tailor, JDs, History (per-job).
  - **Mass-apply**: Dashboard, Inbox, Queue, History (mass-apply), Knowledge, Tiers.
  - **Settings** at bottom.
- Active state per nav item; counts/badges where relevant (e.g. Inbox unread count, Queue needs-you count).
- Test: renders both groups, marks active item, navigates on click.

Source: bundle `ma-shell.jsx`.

**Commit:** `feat(web): suite left nav with grouped sections`

### Task 9: Overview / home page

**Files:**
- Create: `web/src/routes/Overview.tsx` — landing page when no specific route is active. Two-column: left lists recent resumes (per-job), right shows mass-apply pulse (today's counters + max-window gauge expanded + a few inbox + queue items).
- Test: renders both columns from mocked data.

Source: bundle `suite.jsx` (Overview section).

**Commit:** `feat(web): suite overview home page`

### Task 10: ⌘K command palette

**Files:**
- Create: `web/src/components/suite/CommandPalette.tsx` — modal overlay. Fuzzy search across navigations, resume titles (recent), jobs (active), and primitive actions (toggle theme, open notifications, etc.). Keyboard nav (↑/↓/Enter/Esc).
- Test: opens on `Cmd+K`, filters items, fires the right action on Enter.

Source: bundle `ma-shell.jsx` + bundle `suite.jsx`.

**Commit:** `feat(web): cmd-k command palette`

### Task 11: Replace `App.tsx` Shell with Suite shell

**Files:**
- Modify: `web/src/App.tsx` — replace the current `Shell` chrome (button-row nav) with the new TopBar + NavRail. Keep the existing `View` union and route-by-state mechanism for now (replacing it with a router lib is out of scope). Add `'overview' | 'dashboard' | 'tiers' | 'settings' | 'history-massapply'` view values for the new surfaces (placeholders that will be wired in Phase C and E).
- Test: existing App-level test continues to pass; add a new test that asserts the TopBar + NavRail render in default state.

**Commit:** `feat(web): replace shell chrome with suite top bar + nav rail`

---

## Phase C — Mass-apply surface refresh

### Task 12: Inbox redesign

**Files:**
- Modify: `web/src/routes/Inbox.tsx` — apply the design's table+drawer pattern. Use `TierBadge`, `FitChip`, `StatusPill`, `ModeToggle`. Filter chips at top (status + tier + source), sortable headers, drawer with classifier reasoning + 4-stage pipeline trace + artifacts pane.
- Modify: `web/src/components/PostingCard.tsx` — refactor to a row component matching the bundle's design (mono key/value, per-row inline actions).
- Tests: existing tests updated; add a test for the 4-stage pipeline trace rendering.

Source: bundle `ma-screens-1.jsx::Inbox`.

**Commit:** `feat(web): redesign inbox per suite design`

### Task 13: Queue (rename Applications) — 4-lane layout

**Files:**
- Rename: `web/src/routes/Applications.tsx` → `web/src/routes/Queue.tsx`. Update all imports + nav references.
- Modify: `web/src/components/ApplicationCard.tsx` → `web/src/components/QueueCard.tsx`. Card layout per bundle.
- Modify: layout to 4 lanes (Needs you / B-mode / Applying / Paused). Slice 2 only has B-mode prepared, but lay out all four lanes — the others sit empty until Slice 3 lands A-mode + paused states.
- Tests: lane layout + card rendering.

Source: bundle `ma-screens-1.jsx::Queue`.

**Commit:** `feat(web): redesign queue with 4-lane layout`

### Task 14: Knowledge — three tabs

**Files:**
- Modify: `web/src/routes/Knowledge.tsx` — three tabs: **Profile**, **Documents**, **Sources**. Each tab is a section of the existing functionality consolidated:
  - Profile: today's `routes/Profile.tsx` form, restyled.
  - Documents: today's `routes/Knowledge.tsx` document explorer + retrieval search.
  - Sources: today's `routes/Knowledge.tsx` source cards + sync controls + KB ingest sources + (future) job-source families with ToS posture badges. For Slice 2.5, only KB ingest sources exist — job-source families are an empty-state preview.
- Move: the contents of `routes/Profile.tsx` and the existing `routes/Knowledge.tsx` into the new tabbed structure. Delete the old `routes/Profile.tsx` route entry; the route now lives at `Knowledge?tab=profile`.
- Update: `App.tsx` view union — `'profile'` and `'knowledge'` collapse into a single `'knowledge'` view that accepts a `tab` prop.
- Tests: tab switching, each tab renders its prior functionality, deep-link via `?tab=profile`/`?tab=documents`/`?tab=sources`.

Source: bundle `ma-screens-2.jsx::Knowledge`.

**Commit:** `feat(web): collapse profile + knowledge into knowledge tabs`

### Task 15: Onboarding chat — relocate

**Files:**
- Decision: where does Onboarding chat live in the suite? Per the bundle, it's not a top-level destination; the chat is a side-panel inside `Knowledge → Profile` tab (or `Documents` tab; verify against bundle).
- Modify: `web/src/routes/OnboardingChat.tsx` — restructure as a side-panel component, not a full route. Mount it inside `Knowledge.tsx` Profile tab as a docked sidebar (collapsible).
- Remove: the `'onboarding'` view from `App.tsx`'s view union and nav.
- Tests: onboarding chat opens/closes from inside Knowledge → Profile.

**Commit:** `feat(web): dock onboarding chat inside knowledge profile tab`

### Task 16: History (mass-apply) — new

**Files:**
- Create: `web/src/routes/HistoryMassApply.tsx` — table of past applications with R/C/A sent ticks (Resume / Cover letter / Answers), tokens used, wall-clock duration, sparkline header (14-day cadence). Uses the existing `GET /applications?status=submitted` endpoint with `limit=200` (and a load-more button or pagination if total>limit).
- Modify: `App.tsx` view union + nav.
- Tests: renders rows from mocked data, sparkline visible.

Source: bundle `ma-screens-1.jsx::History`.

**Commit:** `feat(web): mass-apply history page`

---

## Phase D — Per-job surface refresh

### Task 17: ResumeList → Library

**Files:**
- Modify: `web/src/routes/ResumeList.tsx` — apply bundle's Library layout. Each resume row uses `PageCountBadge` + `CompileChip`. Source Serif for resume titles.
- Tests: existing tests updated.

Source: bundle `screens-a.jsx::Library`.

**Commit:** `feat(web): redesign resume library per suite design`

### Task 18: Editor + chat side rail + overflow banner

**Files:**
- Modify: `web/src/routes/Editor.tsx` and the chat drawer/side-rail components — apply the bundle's Editor design (PDF as hero, chat as 360px right rail, overflow banner uses red-ink top-chrome border + inline banner + `PageCountBadge` over state).
- Modify: `web/src/components/OverflowBanner.tsx` — bundle's design.
- Tests: existing tests updated; chat opens/closes; overflow visible in over state.

Source: bundle `screens-a.jsx::Editor` + `screens-b.jsx::Overflow`.

**Commit:** `feat(web): redesign editor + chat rail + overflow per suite design`

### Task 19: Diff viewer + Tailor flow + Versions + JDs

**Files:**
- Modify: `web/src/components/DiffView.tsx` — bundle's diff design (numbered hotspots linking to PDF regions, protected-term strip, full compile metadata header).
- Modify: `web/src/components/TailorModal.tsx` — restyled.
- Modify: `web/src/components/VersionHistory.tsx` — restyled with `PageCountBadge` per version.
- Modify: any JD parsing surfaces — restyled.
- Tests: existing tests updated.

Source: bundle `screens-a.jsx` + `screens-b.jsx`.

**Commit:** `feat(web): redesign diff/tailor/versions/jds per suite design`

### Task 20: Resume Onboarding (PDF/LaTeX) — restyled

**Files:**
- Modify: `web/src/routes/Onboarding.tsx` (the existing resume-creation onboarding — paste LaTeX / upload PDF). Restyle to match suite design.
- Tests: existing tests updated.

Source: bundle `screens-a.jsx::Onboarding` (if present; otherwise restyle by analogy).

**Commit:** `feat(web): redesign resume onboarding per suite design`

---

## Phase E — New surfaces

### Task 21: Dashboard

**Files:**
- Create: `web/src/routes/Dashboard.tsx` — KPI band (applied 14d sparkline, queue count, needs-you count, max-window gauge), tier-cap bars, mode-mix donut, needs-you queue (top 3), 11-event activity feed.
- Pulls data from existing endpoints: `GET /postings`, `GET /applications`, `GET /jobs` (the existing tailor jobs), aggregated client-side. No new backend.
- Modify: `App.tsx` view union + nav. Make it the default landing route (replacing the Overview at Task 9 only if desired; otherwise keep both with Overview as `/` and Dashboard as `/dashboard`).
- Tests: renders all KPI tiles, sparkline visible.

Source: bundle `ma-screens-1.jsx::Dashboard`.

**Commit:** `feat(web): mass-apply dashboard`

### Task 22: Tiers configuration page

**Files:**
- Create: `web/src/routes/Tiers.tsx` — threshold ribbon (drag handles for tier boundaries 0–100), 4 tier cards (Dream / Targeted / Wide / Skip), each with: model-per-stage breakdown (classify Haiku, tailor Sonnet, etc.), mode toggle, verifier strictness, daily caps, global override knobs.
- Backend gap: there's no `tiers` table yet — Slice 2 hardcoded thresholds in `services/classify.py`. Two options: (a) add a `tiers` table + endpoints in Slice 3 backend work and ship the UI as read-only-with-explanation now; (b) ship the UI fully editable with localStorage persistence as a stop-gap and migrate to backend storage in Slice 3.
- Recommended path: ship as **read-only display** of the current hardcoded thresholds + a "Tier configuration is coming in Slice 3" notice. Don't fake editability.
- Tests: renders + read-only state asserted.

Source: bundle `ma-screens-2.jsx::Tiers`.

**Commit:** `feat(web): tiers configuration view (read-only, slice 3 backend pending)`

### Task 23: Settings

**Files:**
- Create: `web/src/routes/Settings.tsx` — sections per bundle: Workspace (timezone, locale), API Key (Max subscription status + manual API key field, kept on the client; future Slice 3 will move to server-side claude_router config), Model defaults per stage (display only for now), Exports (download all data — calls existing endpoints), Danger zone (delete all KB / wipe browser artifacts — gated by typed-confirm).
- Most fields are display-only or call existing endpoints. No backend changes.
- Tests: renders, danger-zone confirms before action.

Source: bundle `ma-screens-2.jsx::Settings`.

**Commit:** `feat(web): settings page`

### Task 24: Notifications drawer

**Files:**
- Create: `web/src/components/suite/NotificationsDrawer.tsx` — slide-in drawer triggered by the bell in TopBar. Sections: New / Earlier. Each notification has an icon, title, body, deep link, dismissal. Per-channel push toggles (Pushover/ntfy — placeholder, real wiring is Slice 3).
- Pulls from a client-side notification store seeded by frontend events (job-state changes, sync failures). No backend persistence in Slice 2.5.
- Tests: drawer opens, items render, deep-link fires.

Source: bundle `ma-screens-3.jsx::Notifications`.

**Commit:** `feat(web): notifications drawer`

### Task 25: Empty/loading/error states everywhere

**Files:**
- Sweep: every new and refreshed surface for empty / loading / error states per the bundle. Use shared `EmptyState`, `LoadingSkeleton`, `ErrorBanner` components (create if absent).
- Tests: at least one assertion per surface that the empty state copy from the bundle's microcopy reference renders.

Source: bundle `ma-screens-3.jsx::Microcopy` + per-surface empty states.

**Commit:** `feat(web): empty/loading/error state polish`

---

## Phase F — Polish + E2E

### Task 26: Remove deprecated styles

**Files:**
- Delete: `web/src/index.css` (or whatever the old entry CSS was) once nothing references it.
- Delete: any `routes/Profile.tsx` / `routes/Onboarding.tsx` (chat) leftovers from Phase C migrations.
- Audit: imports across the codebase for stale references.
- Tests: full vitest run — no regressions.

**Commit:** `chore(web): remove deprecated styles + dead routes`

### Task 27: Visual regression / screenshot snapshots (optional)

**Files:**
- If the project has a Storybook or screenshot-test setup: add snapshots for every primitive + each new surface.
- If not: add a minimal Playwright visual test that captures a few key screens (Dashboard, Inbox, Queue, Knowledge tabs) and stores them in `web/e2e/__screenshots__/`. Do not add to default CI; gate behind `LIVE_E2E`.

**Commit:** `test(e2e): visual snapshots for suite surfaces`

### Task 28: Manual smoke + design parity audit

Walk through every bundle screen, compare against the production app, and document any deltas in `docs/plans/2026-04-26-suite-design-pass-deltas.md`. Fix the deltas that are clear bugs; leave intentional differences as documented.

**Commit:** `docs: suite design pass deltas + parity audit notes`

---

## Done criteria

- `web/src/App.tsx` mounts the new Suite shell (TopBar + NavRail + Overview), no more button-row chrome.
- All existing surfaces (per-job + mass-apply) render with the new tokens + primitives.
- All new surfaces (Dashboard, Tiers, Settings, mass-apply History, Notifications drawer, ⌘K) exist and route correctly.
- Dark mode is deliberate, not auto-inverted, and toggles via the TopBar control.
- ⌘K command palette opens with `Cmd+K` and navigates correctly.
- `cd web && npx vitest run` passes (existing 111 tests + ~40 new component tests).
- Visual parity against the bundle's `HireScript Suite.html` is reasonable (screenshots in the deltas doc; intentional differences justified).

## Out of scope

- **Backend changes.** No new endpoints, schemas, migrations, or runners.
- **Slice 3 features**: A-mode autonomous submit, captcha-pause flow, live browser session viewer, push-notification real wiring (`Pushover`/`ntfy`), tier configuration backend, `claude_router` for Max-vs-API.
- **Slice 4 features**: Lever / Ashby / Workable / email / URL-paste / agentic / GitHub-curated source adapters and their config UI.
- **Slice 5 features**: Browser-agent fallback, Notion + personal-website + GitHub-README KB sync.
- **Router library migration.** State-driven view selection stays. Replacing with `react-router` is a separate refactor.

## Open items deferred

- Tiers page is read-only in this slice; full edit experience requires backend work in Slice 3.
- Notifications drawer is client-side-only; persistence + push delivery is Slice 3.
- Settings → API Key is client-side-only; server-side `claude_router` config is Slice 3.
- Source-management UI (in Knowledge → Sources) shows job-source families as empty-state preview; full management arrives in Slice 4.
