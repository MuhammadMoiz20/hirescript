# Phase 8 — Design Pass (apply Linear × Overleaf × iA Writer handoff)

> **For Claude:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.

**Goal:** Apply the design handoff at `design/handoffs/hirescript/` to the production app. Production code adopts the tokens, fonts, theme system, primitives, and screen layouts from the handoff while keeping all behavior wired through the existing api client. After this phase, the app looks like the handoff in light + dark and is ready to ship.

**Anchor:** `design/handoffs/hirescript/project/` — `tokens.css`, `components.jsx`, `screens-a.jsx`, `screens-b.jsx`, `app.jsx`.

**Scope:**
- Apply tokens + fonts globally; add `ThemeProvider` (light/dark) with `localStorage` persistence.
- Port primitive components: `Glyph`, `Button`, `Field`, `Input`, `Textarea`, `PageCountBadge`, `ModelBadge`, `TermPill`, `CompileChip`, `TopChrome`, `NavRail`.
- Refactor each existing screen to use the primitives + handoff layouts: Login, Library (= ResumeList), Onboarding (= NewResumeMenu as a full screen), Editor (with Left Rail + Toolbar + Form/Raw + Chat Rail), Diff, History, Tailor, Overflow.
- Behavior stays 1:1 with current production code (mocks/tests stay green).
- Dark mode works.
- No new product features.

**Out of scope (handoff items deferred):** JDs list screen, Settings screen, Command Palette (Cmd-K), keyboard shortcut surface, Kitchen sink, animated scan shimmer for compile (use static placeholder), drag-reorder.

---

## Task 1: Tokens, fonts, theme provider

**Files:**
- Copy: `design/handoffs/hirescript/project/tokens.css` → `web/src/styles/tokens.css`.
- Modify: `web/index.html` — preconnect + Google Fonts links (Inter, Source Serif 4, JetBrains Mono).
- Modify: `web/src/main.tsx` — `import "./styles/tokens.css"`.
- Create: `web/src/components/ThemeProvider.tsx` — context that toggles `data-theme` on `<html>`, persists to `localStorage("hs-theme")`, default light.

Tests: render a child, toggle theme, assert `<html data-theme="dark">`.

**Commit:** `feat(web): tokens + fonts + theme provider`

---

## Task 2: Primitive components

**Files:** new under `web/src/components/ui/`:
- `Glyph.tsx` — small inline-SVG icon set (port the names used by the handoff: `panel`, `compile`, `clock`, `plus`, `x`, `chat`, `play`, `check`, `alert`, etc.)
- `Button.tsx` — variants `default | primary | ghost | danger`, sizes `sm|md`, optional left/right icon, optional kbd hint.
- `Field.tsx` + `Input.tsx` + `Textarea.tsx` — label-on-top with hint slot.
- `PageCountBadge.tsx` — green ✓ when 1, red ✗ when not 1, neutral when unknown.
- `ModelBadge.tsx` — colored pill for `haiku | sonnet | opus`.
- `TermPill.tsx` — preserved / removed variants.
- `CompileChip.tsx` — meta strip used after a compile (model, page count, latency).
- `TopChrome.tsx` — top bar with wordmark + crumbs + theme toggle (shrink the handoff's nav surface for our scope).

Smoke tests for each: it renders, variants apply expected class/data attribute.

**Commit:** `feat(web): primitive UI components from handoff`

---

## Task 3: Login screen

**Files:** modify `web/src/routes/Login.tsx` — adopt the handoff's `LoginScreen` layout: centered paper card, serif headline, mono caption, `Field`+`Input` for password, primary `Button`. Keep `onSuccess` contract; existing test still passes.

**Commit:** `feat(web): redesign login screen`

---

## Task 4: Library (resume list)

**Files:** modify `web/src/routes/ResumeList.tsx` — port `LibraryScreen` + `MasterCard` + `VariantRow`. Use a column of `MasterCard` instead of bare `<li>`. Each card shows name, last-updated meta, variant count, and a "Tailor to JD" button. Variants render under the master with title @ company on each row.

The "From scratch" inline form moves to a separate **Onboarding** screen (Task 5); on Library, replace `NewResumeMenu` with a single primary "New resume" button that routes to onboarding (or opens it as a full-screen view in our local-state app router — we don't have hash routing, so toggle via state).

Update existing tests to query the new structure (cards still expose master button text).

**Commit:** `feat(web): redesign library screen`

---

## Task 5: Onboarding screen

**Files:** create `web/src/routes/Onboarding.tsx` — adopt `OnboardingScreen` + `PathCard`. Three paths: From scratch / Paste LaTeX / Upload PDF. Right rail: a `TemplateThumbJakes` placeholder (since we only have one template, render only that thumb and skip the picker — keep the visual but remove selectability).

Replace `NewResumeMenu` usage in `App.tsx` so creating a new resume routes to `Onboarding` and back to Library on success. Keep `NewResumeMenu`'s tests but rename to `Onboarding.test.tsx`; same behavior assertions (createResume / onboardTex / onboardPdf called per path).

**Commit:** `feat(web): redesign onboarding (replaces NewResumeMenu)`

---

## Task 6: Editor screen (the big one)

**Files:** modify `web/src/routes/Editor.tsx`. Port:
- `EditorLeftRail` — small icon rail for switching the LEFT pane between Form / LaTeX / History (replaces the pill toggle).
- `EditorToolbar` — top strip with crumbs + Save + Compile + theme toggle.
- `FormEditor` — keep our `SectionFormEditor` content but wrap in handoff styling.
- `RawLatexPanel` — keep CodeMirror but apply the handoff's gutter / token coloring via theme variables.
- `ChatRail` — replace `ChatSidebar`'s look, keep its streaming logic. Add the streaming caret.
- `OverflowBanner` — restyle to match the design (warm strip with `accent` on dark mode).
- Diff display reuses `DiffView` (Task 7).

3-pane layout stays. Behavior: identical to current production. All existing vitest + e2e tests must still pass.

**Commit:** `feat(web): redesign editor screen`

---

## Task 7: Diff view

**Files:** modify `web/src/components/DiffView.tsx`. Port `DiffScreen` + `DiffTable`: side-by-side LaTeX columns with `+` / `-` lines (mono, ink-on-paper), page-count badge in header, removed-terms callout uses `TermPill`.

**Commit:** `feat(web): redesign diff view`

---

## Task 8: History view

**Files:** modify `web/src/components/VersionHistory.tsx`. Port `HistoryScreen` + `VersionRow`. Each row: `edit_source` chip, prompt summary, page count badge, `created_at`, Rollback button. Optional hover-preview deferred.

**Commit:** `feat(web): redesign version history`

---

## Task 9: Tailor flow

**Files:** modify `web/src/components/TailorModal.tsx`. The handoff `TailorScreen` is full-screen; for our app we keep modal semantics but adopt the handoff's form layout (Title / Company / URL / JD textarea / Deep Tailor toggle / Tailor button) inside a `paper` panel with hairline rules.

**Commit:** `feat(web): redesign tailor modal`

---

## Task 10: Polish + body overflow hook + dark-mode QA

**Files:**
- Modify: `web/src/routes/Editor.tsx` — set `document.body.dataset.overflow = pageCount > 1 ? "true" : "false"` so the global CSS overflow accent applies.
- Verify the full e2e suite still passes (7 tests).
- Verify both themes render without obvious regressions by running the vite dev server and inspecting (or screenshot via Playwright in both themes).

**Commit:** `polish(web): overflow body hook + dark-mode pass`

---

## Done criteria

- App matches the handoff aesthetic in both light and dark themes.
- All vitest + e2e tests pass (32 + 7).
- TopChrome with theme toggle visible across screens.
- Editor: left rail icons, toolbar with crumbs, paper panes, mono code.
- No inline-style placeholders in production components (other than minor layout shims).
