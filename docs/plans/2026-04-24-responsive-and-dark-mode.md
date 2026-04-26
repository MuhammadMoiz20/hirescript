# Responsive Layout + Dark Mode Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the four web screens responsive across mobile / tablet / desktop and fix dark-mode legibility issues across all panels.

**Architecture:** A single `useBreakpoint()` hook gates layout branching in route components. The Editor gets a tablet (chat drawer) and mobile (bottom tab bar) variant; auxiliary screens use CSS-only stacking. Dark mode is repaired by adding `color-scheme`, OS-preference defaulting, a CodeMirror dark theme, tokenizing remaining hardcoded literals, and a global form-control rule.

**Tech Stack:** React 18, Vite, TypeScript, Vitest + RTL, `@uiw/react-codemirror`, CSS custom properties.

Reference design: `docs/plans/2026-04-24-responsive-and-dark-mode-design.md`.

---

## Conventions

- All file paths are relative to repo root.
- Run all `npm` commands inside `web/` (use `cd web && npm test -- --run` if run from repo root, or run from `web/` directly).
- Each task ends with a commit. Use Conventional Commits, scope `web`.
- TDD where the change has a behavior to assert; pure styling/CSS sweeps don't need a unit test but DO get a manual verification step.
- Don't combine tasks. Commit at every task boundary.

---

## Task 1: `useBreakpoint` hook

**Files:**
- Create: `web/src/hooks/useBreakpoint.ts`
- Test: `web/src/hooks/useBreakpoint.test.ts`

**Step 1: Write the failing test**

```ts
// web/src/hooks/useBreakpoint.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBreakpoint } from "./useBreakpoint";

function mockMatchMedia(width: number) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const m = query.match(/min-width:\s*(\d+)px/);
    const min = m ? Number(m[1]) : 0;
    return {
      matches: width >= min,
      media: query,
      addEventListener: (_: string, cb: any) => listeners.add(cb),
      removeEventListener: (_: string, cb: any) => listeners.delete(cb),
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    } as MediaQueryList;
  });
}

describe("useBreakpoint", () => {
  beforeEach(() => {
    mockMatchMedia(1400);
  });

  it("returns 'desktop' at >=1200px", () => {
    mockMatchMedia(1400);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("desktop");
  });

  it("returns 'tablet' between 768 and 1199", () => {
    mockMatchMedia(900);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("tablet");
  });

  it("returns 'mobile' below 768", () => {
    mockMatchMedia(500);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("mobile");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useBreakpoint.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```ts
// web/src/hooks/useBreakpoint.ts
import { useEffect, useState } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

const TABLET_MIN = "(min-width: 768px)";
const DESKTOP_MIN = "(min-width: 1200px)";

function read(): Breakpoint {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(DESKTOP_MIN).matches) return "desktop";
  if (window.matchMedia(TABLET_MIN).matches) return "tablet";
  return "mobile";
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => read());
  useEffect(() => {
    const tabletMql = window.matchMedia(TABLET_MIN);
    const desktopMql = window.matchMedia(DESKTOP_MIN);
    const update = () => setBp(read());
    tabletMql.addEventListener("change", update);
    desktopMql.addEventListener("change", update);
    return () => {
      tabletMql.removeEventListener("change", update);
      desktopMql.removeEventListener("change", update);
    };
  }, []);
  return bp;
}
```

**Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useBreakpoint.test.ts`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add web/src/hooks/useBreakpoint.ts web/src/hooks/useBreakpoint.test.ts
git commit -m "feat(web): add useBreakpoint hook"
```

---

## Task 2: ThemeProvider OS preference default

**Files:**
- Modify: `web/src/components/ThemeProvider.tsx`
- Modify: `web/src/components/ThemeProvider.test.tsx`

**Step 1: Update test (add new cases)**

Add to `ThemeProvider.test.tsx`:

```tsx
it("defaults to OS dark when no stored value", () => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes("dark"),
    media: q, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
  } as MediaQueryList));
  render(<ThemeProvider><Probe/></ThemeProvider>);
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("respects stored value over OS preference", () => {
  localStorage.setItem("hs-theme", "light");
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: true, media: "", addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
  } as MediaQueryList));
  render(<ThemeProvider><Probe/></ThemeProvider>);
  expect(document.documentElement.dataset.theme).toBe("light");
});
```

`Probe` is whatever existing test util the file uses; if none, render `<div data-testid="x">{useTheme().theme}</div>` and assert via the DOM dataset (more robust). Reuse what's already in the file.

**Step 2: Run, expect failures**

Run: `cd web && npx vitest run src/components/ThemeProvider.test.tsx`
Expected: FAIL on the new cases — current code hardcodes `"light"`.

**Step 3: Update implementation**

```tsx
// web/src/components/ThemeProvider.tsx
import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";

type Theme = "light" | "dark";
const KEY = "hs-theme";

function readStored(): Theme | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : null;
}

function osPref(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });
export function useTheme() { return useContext(Ctx); }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? osPref());
  const [explicit, setExplicit] = useState<boolean>(() => readStored() !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (explicit) localStorage.setItem(KEY, theme);
  }, [theme, explicit]);

  // Track OS changes ONLY when user has not made an explicit choice.
  useEffect(() => {
    if (explicit) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [explicit]);

  const value = useMemo(() => ({
    theme,
    toggle: () => {
      setExplicit(true);
      setTheme(t => (t === "light" ? "dark" : "light"));
    },
  }), [theme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

**Step 4: Run all theme tests, expect green**

Run: `cd web && npx vitest run src/components/ThemeProvider.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add web/src/components/ThemeProvider.tsx web/src/components/ThemeProvider.test.tsx
git commit -m "fix(web): theme defaults to OS preference until user toggles"
```

---

## Task 3: Global form-control + `color-scheme` CSS

**Files:**
- Modify: `web/src/styles/tokens.css`

**Step 1: Add global rules**

Append after the existing `input, textarea, select { font: inherit; color: inherit; }` block:

```css
:root { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }

input, textarea, select {
  background: var(--paper);
  color: var(--ink);
  caret-color: var(--ink);
}

input::placeholder, textarea::placeholder { color: var(--ink-4); }

/* Autofill — Chrome paints a yellow box; coerce to tokens. */
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus {
  -webkit-text-fill-color: var(--ink);
  -webkit-box-shadow: 0 0 0 1000px var(--paper) inset;
  caret-color: var(--ink);
}
```

Also add a chrome var for the mobile tab bar height:

```css
:root { --bottom-chrome: 56px; }
```

(Add inside the existing `:root` block where `--top-chrome` is defined.)

**Step 2: Verify**

Run: `cd web && npm run dev` (background OK). Open the app, toggle theme on Login. Inputs must have dark background and light text in dark mode.

**Step 3: Commit**

```bash
git add web/src/styles/tokens.css
git commit -m "fix(web): tokenize form-control colors + color-scheme for dark mode"
```

---

## Task 4: PdfPreview tokenize border

**Files:**
- Modify: `web/src/components/PdfPreview.tsx:26`

**Step 1: Replace literal**

Change `border: "1px solid #ccc"` → `border: "1px solid var(--rule)"`.

**Step 2: Verify**

Open editor in dark mode, verify the canvas border is no longer a stuck light gray.

**Step 3: Commit**

```bash
git add web/src/components/PdfPreview.tsx
git commit -m "fix(web): tokenize PdfPreview canvas border"
```

---

## Task 5: CodeMirror dark theme switch

**Files:**
- Modify: `web/package.json` (add dep)
- Modify: `web/src/routes/Editor.tsx` (`<CodeMirror>` mount)

**Step 1: Install themes**

```bash
cd web && npm install @uiw/codemirror-theme-github
```

The `@uiw/codemirror-theme-github` package exports both `githubLight` and `githubDark`. One package, both modes.

**Step 2: Wire into Editor**

In `web/src/routes/Editor.tsx`, near the imports:

```tsx
import { githubLight, githubDark } from "@uiw/codemirror-theme-github";
import { useTheme } from "../components/ThemeProvider";
```

Inside the component, after existing state hooks:

```tsx
const { theme } = useTheme();
const cmTheme = theme === "dark" ? githubDark : githubLight;
```

Update the `<CodeMirror>` mount (around line 213):

```tsx
<CodeMirror
  value={latex}
  extensions={[StreamLanguage.define(stex)]}
  theme={cmTheme}
  onChange={setLatex}
  height="100%"
  style={{ height: "100%" }}
/>
```

**Step 3: Verify**

Run dev server, open the Editor's LaTeX view, toggle theme. Editor surface must switch between light and dark with readable syntax colors.

**Step 4: Commit**

```bash
git add web/package.json web/package-lock.json web/src/routes/Editor.tsx
git commit -m "fix(web): switch CodeMirror theme with app theme"
```

---

## Task 6: Responsive Login + ResumeList + Onboarding

**Files:**
- Modify: `web/src/routes/Login.tsx`
- Modify: `web/src/routes/ResumeList.tsx`
- Modify: `web/src/routes/Onboarding.tsx`

These are CSS-only changes. No new tests; existing tests must continue to pass.

**Step 1: Login**

Find the login card style block (around line 41 with `border: "1px solid var(--rule)"`). Replace inline `width`/`maxWidth` with:

```ts
{
  width: "min(360px, calc(100% - 32px))",
  padding: "clamp(20px, 4vw, 32px)",
  // ...existing border/background
}
```

Wrap the page in a `padding: 16` container if it isn't already.

**Step 2: ResumeList**

In `ResumeList.tsx` line 169 area:

```tsx
<div style={{
  maxWidth: 860,
  margin: "0 auto",
  padding: "clamp(16px, 3vw, 24px)",
}}>
```

In the header (line 170 region), add `flexWrap: "wrap"` and `gap: 12` so the title block and the "New resume" button stack on mobile:

```tsx
<div style={{
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: 12,
  marginBottom: 20,
}}>
```

`MasterCard`'s action row already has `flexWrap: "wrap"` — leave it.

**Step 3: Onboarding**

Open `Onboarding.tsx`. Wherever it has a 2-column layout (look for `gridTemplateColumns: "1fr 1fr"` or similar), wrap the value with a media query — easiest path is inline using a `useBreakpoint()` branch:

```tsx
import { useBreakpoint } from "../hooks/useBreakpoint";
const bp = useBreakpoint();
// ...
gridTemplateColumns: bp === "mobile" ? "1fr" : "1fr 1fr",
```

If the stepper is rendered as a horizontal row, give its container `flexWrap: "wrap"` and `rowGap: 12`.

**Step 4: Run existing tests**

```bash
cd web && npx vitest run src/routes
```
Expected: PASS (no behavioral changes).

**Step 5: Manual verify**

Open dev server, resize browser through 360 / 800 / 1400 widths. All three screens must be usable with no horizontal scroll and no clipped content.

**Step 6: Commit**

```bash
git add web/src/routes/Login.tsx web/src/routes/ResumeList.tsx web/src/routes/Onboarding.tsx
git commit -m "feat(web): make Login, ResumeList, Onboarding responsive"
```

---

## Task 7: Editor tablet layout — chat drawer

**Files:**
- Create: `web/src/components/editor/ChatDrawer.tsx`
- Modify: `web/src/routes/Editor.tsx`
- Test: `web/src/components/editor/ChatDrawer.test.tsx`

**Step 1: Failing test**

```tsx
// web/src/components/editor/ChatDrawer.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ChatDrawer from "./ChatDrawer";

describe("ChatDrawer", () => {
  it("renders children when open and calls onClose on backdrop click", () => {
    const onClose = vi.fn();
    render(<ChatDrawer open onClose={onClose}><div>chat</div></ChatDrawer>);
    expect(screen.getByText("chat")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chat-drawer-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    render(<ChatDrawer open={false} onClose={() => {}}><div>chat</div></ChatDrawer>);
    expect(screen.queryByText("chat")).toBeNull();
  });
});
```

Run: FAIL (module missing).

**Step 2: Implement**

```tsx
// web/src/components/editor/ChatDrawer.tsx
import { ReactNode } from "react";

interface Props { open: boolean; onClose: () => void; children: ReactNode; }

export default function ChatDrawer({ open, onClose, children }: Props) {
  if (!open) return null;
  return (
    <>
      <div
        data-testid="chat-drawer-backdrop"
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 40,
          background: "color-mix(in oklch, var(--ink) 35%, transparent)",
        }}
      />
      <aside
        role="dialog"
        aria-label="Chat"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "min(380px, 90vw)",
          background: "var(--paper-2)", borderLeft: "1px solid var(--rule-strong)",
          zIndex: 41, display: "flex", flexDirection: "column",
        }}
      >
        {children}
      </aside>
    </>
  );
}
```

Run: PASS.

**Step 3: Wire into Editor**

In `Editor.tsx`, import the hook + drawer:

```tsx
import { useBreakpoint } from "../hooks/useBreakpoint";
import ChatDrawer from "../components/editor/ChatDrawer";
```

Add state:
```tsx
const bp = useBreakpoint();
const [chatOpen, setChatOpen] = useState(false);
```

Branch the grid:
```tsx
gridTemplateColumns:
  bp === "desktop" ? "48px minmax(0,1fr) minmax(0,1fr) 360px"
  : bp === "tablet" ? "48px minmax(0,1fr) minmax(0,1fr)"
  : "1fr",
```

When `bp !== "desktop"`, do not render the chat rail in the grid; instead render `<ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)}><ChatSidebar ... /></ChatDrawer>`. Add a chat trigger to `EditorToolbar` (icon button — pass new prop `onOpenChat?: () => void`, render only when provided).

Mobile branch (`bp === "mobile"`) is handled in Task 8 — for this task, render the desktop content for mobile too; we'll override next.

**Step 4: Verify**

`cd web && npx vitest run` — all green.
Manual: resize to 1000px wide. Chat icon appears in toolbar; clicking opens drawer; backdrop click closes.

**Step 5: Commit**

```bash
git add web/src/components/editor/ChatDrawer.tsx web/src/components/editor/ChatDrawer.test.tsx web/src/routes/Editor.tsx web/src/components/editor/EditorToolbar.tsx
git commit -m "feat(web): tablet editor layout collapses chat into drawer"
```

---

## Task 8: Editor mobile layout — bottom tab bar

**Files:**
- Create: `web/src/components/editor/MobileTabBar.tsx`
- Test: `web/src/components/editor/MobileTabBar.test.tsx`
- Modify: `web/src/routes/Editor.tsx`

**Step 1: Failing test**

```tsx
// MobileTabBar.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import MobileTabBar, { MobileTab } from "./MobileTabBar";

describe("MobileTabBar", () => {
  it("renders 4 tabs and calls onChange", () => {
    const onChange = vi.fn();
    render(<MobileTabBar value="edit" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /preview/i }));
    expect(onChange).toHaveBeenCalledWith<[MobileTab]>("preview");
  });

  it("marks the active tab aria-selected", () => {
    render(<MobileTabBar value="chat" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: /chat/i })).toHaveAttribute("aria-selected", "true");
  });
});
```

Run: FAIL.

**Step 2: Implement**

```tsx
// MobileTabBar.tsx
export type MobileTab = "edit" | "preview" | "chat" | "history";

const TABS: { id: MobileTab; label: string }[] = [
  { id: "edit", label: "Edit" },
  { id: "preview", label: "Preview" },
  { id: "chat", label: "Chat" },
  { id: "history", label: "History" },
];

interface Props { value: MobileTab; onChange: (t: MobileTab) => void; }

export default function MobileTabBar({ value, onChange }: Props) {
  return (
    <nav
      role="tablist"
      style={{
        height: "var(--bottom-chrome)",
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        borderTop: "1px solid var(--rule)", background: "var(--paper)",
        paddingBottom: "env(safe-area-inset-bottom)",
        flexShrink: 0,
      }}
    >
      {TABS.map(t => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            style={{
              fontSize: 12, fontFamily: "var(--f-mono)",
              color: active ? "var(--ink)" : "var(--ink-3)",
              borderTop: active ? "2px solid var(--ink)" : "2px solid transparent",
              background: "transparent",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
```

Run: PASS.

**Step 3: Mobile branch in Editor**

In `Editor.tsx`, add:

```tsx
const [mobileTab, setMobileTab] = useState<MobileTab>("edit");
```

When `bp === "mobile"`, render an entirely different tree (early-return inside the same component to keep state hooks stable):

```tsx
if (bp === "mobile") {
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome>...</TopChrome>
      <EditorToolbar ... />
      <OverflowBanner ... />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {mobileTab === "edit" && (
          /* Form/LaTeX switch + active editor pane */
        )}
        {mobileTab === "preview" && (
          proposed ? <DiffView ... /> : error ? <pre>...</pre> : <PdfPreview ... />
        )}
        {mobileTab === "chat" && <ChatSidebar ... />}
        {mobileTab === "history" && <VersionHistory ... />}
      </div>
      <MobileTabBar value={mobileTab} onChange={setMobileTab} />
    </div>
  );
}
```

For the Edit tab's Form ↔ LaTeX switch, reuse `EditorLeftRail` rendered horizontally — accept a new optional prop `orientation?: "vertical" | "horizontal"` (default "vertical") and adjust the flex direction.

**Step 4: Verify**

```bash
cd web && npx vitest run
```
Manual: resize to 375px. Bottom tab bar visible, all four tabs functional, no horizontal scroll, keyboard works in chat textarea (use `100dvh`, not `100vh`).

**Step 5: Commit**

```bash
git add web/src/components/editor/MobileTabBar.tsx web/src/components/editor/MobileTabBar.test.tsx web/src/components/editor/EditorLeftRail.tsx web/src/routes/Editor.tsx
git commit -m "feat(web): mobile editor uses bottom-tab navigation"
```

---

## Task 9: Sweep remaining hardcoded colors + final QA

**Files:**
- Audit: any file in `web/src` that grep finds with non-token color literals.

**Step 1: Sweep**

Run:
```bash
grep -rEn '#[0-9a-fA-F]{3,8}\b|background:\s*"(white|black)"|color:\s*"(white|black)"' web/src --include="*.tsx" --include="*.ts"
```

For each hit (excluding `tokens.css`), replace with a token. Known offenders after Task 4: should be empty except `--warn, #a60` token fallback in `Onboarding.tsx` line 281, which is acceptable (it's a fallback).

**Step 2: Run full test suite**

```bash
cd web && npx vitest run
```
Expected: PASS, all suites.

**Step 3: Manual QA matrix**

For each (screen × breakpoint × theme) — 4 × 3 × 2 = 24 — visually verify:
- No white-on-white or black-on-black text.
- No horizontal scroll.
- All interactive controls reachable.
- Theme toggle persists across navigation.

Screens: Login, ResumeList, Onboarding, Editor.
Breakpoints: 375px, 900px, 1400px.
Themes: light, dark.

Take a screenshot of each problem state if any. Fix and re-run.

**Step 4: Commit any sweep fixes**

```bash
git add -A
git commit -m "fix(web): tokenize remaining color literals"
```

---

## Final verification

```bash
cd web && npx vitest run
cd web && npm run build
```

Both must succeed with no errors.

Open a PR titled `feat(web): responsive layout + dark mode fixes` summarizing the design doc.
