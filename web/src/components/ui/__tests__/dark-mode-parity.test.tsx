import { render, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, test, expect } from "vitest";
import { ReactElement } from "react";

import PageCountBadge from "../PageCountBadge";
import CompileChip from "../CompileChip";
import ModelBadge from "../ModelBadge";
import ProtectedTermPill from "../ProtectedTermPill";
import TierBadge from "../TierBadge";
import FitChip from "../FitChip";
import StatusPill from "../StatusPill";
import ModeToggle from "../ModeToggle";
import MaxGauge from "../MaxGauge";
import Sparkline from "../Sparkline";
import { ThemeProvider, useTheme } from "../../ThemeProvider";

/**
 * Dark-mode parity sweep (slice 2.5 / T6).
 *
 * Each new primitive from T3–T5 was audited and references only CSS custom
 * properties from `tokens.css` / `tokens-massapply.css`. Both stylesheets
 * define `[data-theme="dark"]` overrides for every variable in use
 * (--paper*, --ink*, --rule*, --ok/err/warn/accent[-soft], --haiku/sonnet/opus,
 * --tier-*[-soft], --gauge-track). Therefore parity is achieved by token flip
 * rather than per-component dark variants — this suite confirms each
 * primitive mounts cleanly in both modes and exposes a stable
 * data-attribute hook the rest of the app can rely on.
 */

interface Case {
  name: string;
  el: ReactElement;
  /** Selector for an element that must exist after mount in both modes. */
  marker: string;
}

const CASES: Case[] = [
  { name: "PageCountBadge ok",       el: <PageCountBadge state="ok" />,          marker: '[data-state="ok"]' },
  { name: "PageCountBadge over",     el: <PageCountBadge state={3} />,           marker: '[data-state="over"]' },
  { name: "PageCountBadge compiling",el: <PageCountBadge state="compiling" />,   marker: '[data-state="compiling"]' },
  { name: "CompileChip done",        el: <CompileChip kind="done" model="haiku" iterations={1} pageCount={1} />, marker: '[data-kind="done"]' },
  { name: "CompileChip failed",      el: <CompileChip kind="failed" />,          marker: '[data-kind="failed"]' },
  { name: "ModelBadge sonnet",       el: <ModelBadge model="sonnet" />,          marker: '.mono' },
  { name: "ProtectedTermPill preserved", el: <ProtectedTermPill>Built</ProtectedTermPill>, marker: '[data-variant="preserved"]' },
  { name: "ProtectedTermPill removed",   el: <ProtectedTermPill variant="removed">Foo</ProtectedTermPill>, marker: '[data-variant="removed"]' },
  { name: "TierBadge dream",         el: <TierBadge tier="dream" />,             marker: '[data-tier="dream"]' },
  { name: "TierBadge wide",          el: <TierBadge tier="wide" size="lg" />,    marker: '[data-tier="wide"]' },
  { name: "FitChip strong",          el: <FitChip score={92} />,                 marker: '[data-band="strong"]' },
  { name: "FitChip unknown",         el: <FitChip score={null} />,               marker: '[data-band="unknown"]' },
  { name: "StatusPill running",      el: <StatusPill status="running" />,        marker: '[data-status="running"]' },
  { name: "StatusPill failed",       el: <StatusPill status="failed" />,         marker: '[data-status="failed"]' },
  { name: "ModeToggle A",            el: <ModeToggle mode="A" />,                marker: '[data-mode="A"]' },
  { name: "ModeToggle B override",   el: <ModeToggle mode="B" override />,       marker: '[data-mode="B"]' },
  { name: "MaxGauge ok compact",     el: <MaxGauge usedPct={20} resetsAt={new Date(Date.now() + 3_600_000)} />, marker: '[data-band="ok"]' },
  { name: "MaxGauge err expanded",   el: <MaxGauge usedPct={95} resetsAt={new Date(Date.now() + 3_600_000)} size="expanded" />, marker: '[data-band="err"]' },
  { name: "Sparkline 14d",           el: <Sparkline data={[1,0,2,3,1,0,1,2,4,3,2,1,5,2]} />, marker: '[data-points="14"]' },
  { name: "Sparkline empty",         el: <Sparkline data={[]} />,                marker: '[data-empty="true"]' },
];

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("dark mode parity for new primitives", () => {
  for (const c of CASES) {
    test(`${c.name} mounts in light and dark`, () => {
      // Light
      document.documentElement.dataset.theme = "light";
      const { container, unmount } = render(c.el);
      expect(container.querySelector(c.marker)).not.toBeNull();
      unmount();

      // Dark
      document.documentElement.dataset.theme = "dark";
      const { container: c2 } = render(c.el);
      expect(c2.querySelector(c.marker)).not.toBeNull();
    });
  }
});

/** Confirms ThemeProvider drives the documentElement attribute used by tokens. */
describe("ThemeProvider data-theme propagation", () => {
  function Probe() {
    const { theme, toggle } = useTheme();
    return <button data-theme-probe={theme} onClick={toggle}>{theme}</button>;
  }

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  test("toggle propagates data-theme to documentElement", () => {
    const { getByRole } = render(<ThemeProvider><Probe /></ThemeProvider>);
    const initial = document.documentElement.getAttribute("data-theme");
    expect(initial === "light" || initial === "dark").toBe(true);

    act(() => { getByRole("button").click(); });
    const next = document.documentElement.getAttribute("data-theme");
    expect(next).not.toBe(initial);
    expect(next === "light" || next === "dark").toBe(true);

    act(() => { getByRole("button").click(); });
    expect(document.documentElement.getAttribute("data-theme")).toBe(initial);
  });
});
