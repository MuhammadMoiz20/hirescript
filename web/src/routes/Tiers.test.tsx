/**
 * Tiers route tests — verify the read-only tier policy display.
 *
 * The view is intentionally inert: no API calls, no mutations, no draggable
 * handles. Tests assert the values match the canonical thresholds in
 * `api/app/services/classify.py` and that all interactive surfaces are
 * disabled.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import Tiers from "./Tiers";

describe("Tiers route", () => {
  test("renders page header with eyebrow + serif title", () => {
    render(<Tiers />);
    expect(screen.getByText("Tiers")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /classifier's verdict/i }),
    ).toBeInTheDocument();
  });

  test("surfaces a read-only banner pointing at the Slice 3 backend gap", () => {
    render(<Tiers />);
    const banner = screen.getByTestId("tiers-readonly-banner");
    expect(banner).toHaveTextContent(/coming in slice 3/i);
    expect(banner).toHaveTextContent(/api\/app\/services\/classify\.py/);
  });

  test("renders threshold ribbon with one segment per tier (no drag handles)", () => {
    render(<Tiers />);
    const ribbon = screen.getByTestId("tiers-ribbon");
    expect(ribbon).toBeInTheDocument();
    for (const id of ["dream", "targeted", "wide", "skip"] as const) {
      expect(within(ribbon).getByTestId(`ribbon-seg-${id}`)).toBeInTheDocument();
    }
    // Boundary markers exist at the canonical thresholds.
    for (const v of [40, 60, 85]) {
      const mark = within(ribbon).getByTestId(`ribbon-mark-${v}`);
      expect(mark).toBeInTheDocument();
      // No `cursor: ew-resize` — the bundle's draggable affordance is removed.
      expect(mark.getAttribute("style") || "").not.toMatch(/ew-resize/);
    }
  });

  test("renders all four tier cards with the correct fit-score ranges", () => {
    render(<Tiers />);
    const expected = [
      { id: "dream", range: "85–100" },
      { id: "targeted", range: "60–84" },
      { id: "wide", range: "40–59" },
      { id: "skip", range: "0–39" },
    ];
    for (const { id, range } of expected) {
      const card = screen.getByTestId(`tier-card-${id}`);
      expect(card).toBeInTheDocument();
      expect(within(card).getByText(`fit ${range}`)).toBeInTheDocument();
    }
  });

  test("each tier card shows a per-stage model breakdown (Classify/Research/Tailor/Cover)", () => {
    render(<Tiers />);
    for (const id of ["dream", "targeted", "wide", "skip"] as const) {
      const block = screen.getByTestId(`tier-card-${id}-models`);
      expect(within(block).getByText(/^Classify$/i)).toBeInTheDocument();
      expect(within(block).getByText(/^Research$/i)).toBeInTheDocument();
      expect(within(block).getByText(/^Tailor$/i)).toBeInTheDocument();
      expect(within(block).getByText(/^Cover$/i)).toBeInTheDocument();
    }
  });

  test("ModeToggle in every tier card is disabled (read-only indicator)", () => {
    render(<Tiers />);
    for (const id of ["dream", "targeted", "wide", "skip"] as const) {
      const card = screen.getByTestId(`tier-card-${id}`);
      const toggle = within(card).getByRole("group", { name: /mode toggle/i });
      expect(toggle).toHaveAttribute("data-disabled", "true");
      // Both A/B buttons should be disabled.
      const buttons = within(toggle).getAllByRole("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      for (const b of buttons) {
        expect(b).toBeDisabled();
      }
    }
  });

  test("verifier strictness reflects backend tier rules (strict/lenient/n/a)", () => {
    render(<Tiers />);
    expect(screen.getByTestId("tier-card-dream-verifier")).toHaveTextContent("strict");
    expect(screen.getByTestId("tier-card-targeted-verifier")).toHaveTextContent("strict");
    expect(screen.getByTestId("tier-card-wide-verifier")).toHaveTextContent("lenient");
    expect(screen.getByTestId("tier-card-skip-verifier")).toHaveTextContent("n/a");
  });

  test("global override knobs render as placeholders, not editable inputs", () => {
    render(<Tiers />);
    expect(screen.getByTestId("tiers-placeholder-mode-floor")).toBeInTheDocument();
    expect(screen.getByTestId("tiers-placeholder-daily-mass-cap")).toBeInTheDocument();
    expect(
      screen.getByTestId("tiers-placeholder-spending-kill-switch"),
    ).toBeInTheDocument();
    // No <input> or <button type="submit"> escapes — view is fully inert.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save/i }),
    ).not.toBeInTheDocument();
  });

  test("footer notes Slice 3 will add edit + persist", () => {
    render(<Tiers />);
    expect(
      screen.getByText(/slice 3 will introduce a/i),
    ).toBeInTheDocument();
  });
});
