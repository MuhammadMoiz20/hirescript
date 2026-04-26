# Responsive Layout + Dark Mode Fix — Design

Date: 2026-04-24
Status: Approved (pending implementation plan)

## Problem

Two related issues affect the web UI:

1. **Not responsive.** The Editor uses a fixed 4-column grid (`48px 1fr 1fr 360px`) and assumes desktop width. Login, ResumeList, Onboarding render acceptably narrow but were not designed against breakpoints. The app is unusable on phones and cramped on tablets.
2. **Dark mode partially broken.** Tokens and `ThemeProvider` exist and the toggle is wired up in `TopChrome`. But several surfaces don't theme correctly — panels keep light backgrounds, form-field text stays light against a light background, and a few hardcoded literals (`#ccc`, browser-default form chrome, CodeMirror's default light theme) leak through. Net effect: text is illegible in places under dark mode.

## Goals

- All four screens (Login, Onboarding, ResumeList, Editor) work cleanly at three breakpoint bands: mobile (<768px), tablet (768–1199px), desktop (≥1200px).
- Editor on mobile uses a bottom-tab-bar workflow so all four panes (Edit / Preview / Chat / History) are reachable.
- Dark mode looks correct on every surface — no white-on-white text, no stuck light panels, no untoned borders.
- First-run users get the OS-preferred theme; explicit toggles still persist via `localStorage`.

## Non-Goals

- Theming CodeMirror's syntax palette beyond switching to a dark base.
- Redesigning components — visual language and tokens stay.
- Mobile-specific gestures beyond standard tab navigation.

## Breakpoints

```
mobile : <768px
tablet : 768–1199px
desktop: ≥1200px
```

Exposed as a single hook `useBreakpoint()` returning `'mobile' | 'tablet' | 'desktop'`, backed by `matchMedia`. Layout components branch on this; primitive components (Button, Input, Field, etc.) stay breakpoint-agnostic.

## Editor Layout per Breakpoint

**Desktop (≥1200px)** — unchanged: `48px 1fr 1fr 360px` grid. Left rail / center / preview / chat.

**Tablet (768–1199px)** — three columns: `48px 1fr 1fr`. Chat collapses into a slide-over drawer triggered by a chat icon in the toolbar. Preview and center keep their split.

**Mobile (<768px)** — single full-width pane plus a fixed bottom tab bar with four tabs:

```
┌────────────────────────┐
│ TopChrome (compact)    │
├────────────────────────┤
│                        │
│   active pane          │
│   (full width/height)  │
│                        │
├────────────────────────┤
│ Edit  Preview  Chat  Hx│  ← bottom tab bar (56px)
└────────────────────────┘
```

- The Edit tab keeps a small Form ↔ LaTeX segmented switch at the top (replacing the desktop left rail).
- Bottom tab bar uses `position: sticky; bottom: 0` with `safe-area-inset-bottom` padding.
- Diff view, when a proposal is open, takes over the Preview tab and shows an Accept/Reject sticky footer.
- Overflow banner remains top-of-pane on Edit and Preview tabs.

## Other Screens

- **Login**: card narrows to `min(360px, calc(100% - 32px))`, padding shrinks at <768px. No structural change.
- **ResumeList**: grid becomes 1 column <768px, 2 columns 768–1199px, 3 columns ≥1200px. Header actions stack vertically on mobile.
- **Onboarding**: stepper becomes vertical on mobile; PDF upload card and form column stack instead of side-by-side.
- **TopChrome**: breadcrumb truncates with ellipsis on mobile; theme toggle stays.

## Dark Mode Fixes

Five concrete issues to address:

1. **Initial theme respects OS.** `ThemeProvider` currently defaults to `"light"`. Change initial state: if no `localStorage` value, read `prefers-color-scheme`. Listen for changes only when no manual choice is stored.
2. **Form controls inherit theme.** Add a global rule:
   ```css
   input, textarea, select {
     background: var(--paper);
     color: var(--ink);
     color-scheme: light dark;
   }
   ```
   `color-scheme` lets the browser theme native bits (autofill, scrollbars, date pickers).
3. **CodeMirror dark theme.** The LaTeX editor's `<CodeMirror>` mount must accept a `theme` extension. Ship `@uiw/codemirror-theme-github` (light) and `@uiw/codemirror-theme-tokyo-night` (or equivalent dark) and switch based on `useTheme()`.
4. **PdfPreview.** Replace `border: "1px solid #ccc"` with `var(--rule)`. The PDF canvas itself stays white (it's a document) but the surrounding panel background uses `var(--paper-2)`.
5. **Audit hardcoded panel backgrounds.** Sweep components for `background: "white"`, `"#fff"`, raw hex, or missing background in dark contexts. Fix to tokens. Files flagged by initial grep: `PdfPreview.tsx`, `Onboarding.tsx` (one `--warn` fallback uses `#a60` — keep, it's a token fallback). Any field whose text is `var(--ink)` against an unset white parent gets explicit `background: var(--paper)`.

## Component Inventory

New:
- `web/src/hooks/useBreakpoint.ts` — `matchMedia`-backed hook.
- `web/src/components/editor/MobileTabBar.tsx` — bottom tab bar with 4 tabs and active state.
- `web/src/components/editor/MobileEditorLayout.tsx` — orchestrates pane switching on mobile.
- `web/src/components/editor/ChatDrawer.tsx` — tablet-only slide-over chat panel.

Modified:
- `web/src/routes/Editor.tsx` — branch layout on breakpoint.
- `web/src/routes/Login.tsx`, `ResumeList.tsx`, `Onboarding.tsx` — responsive grids/stacks.
- `web/src/components/ThemeProvider.tsx` — OS preference default + media-query listener.
- `web/src/components/PdfPreview.tsx` — token border.
- `web/src/styles/tokens.css` — global form control rule, `color-scheme`, mobile chrome height var.
- `web/src/components/editor/EditorLeftRail.tsx` — usable as inline segmented switch for mobile Edit tab.

## Testing

- Component tests: `useBreakpoint` (mocked `matchMedia`), `MobileTabBar` switch behavior, `ThemeProvider` reads `prefers-color-scheme` when storage empty.
- Snapshot/RTL tests: existing tests must still pass; add a mobile-viewport render test for `Editor` that asserts the bottom tab bar renders and one pane is visible.
- Manual QA matrix: 4 screens × 3 breakpoints × 2 themes = 24 states; spot-check each.

## Risks

- CodeMirror theme swap requires re-mounting or extension reconfigure; the `@uiw/react-codemirror` `theme` prop handles this but pulls a new dep.
- Bottom tab bar + mobile keyboard interaction (chat textarea) needs `viewport-fit=cover` and `100dvh` for the active pane; iOS Safari keyboard quirks are the most likely surprise.
- `prefers-color-scheme` listener must not stomp on a user's explicit toggle — store an explicit "user has chosen" flag, not just the theme value.

## Out-of-Scope Follow-ups

- Container queries for nested panels (would let preview adapt to its actual width, not viewport).
- True mobile gestures (swipe between tabs).
- Per-component dark-mode visual polish beyond legibility.
