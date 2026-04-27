import { render, screen } from "@testing-library/react";
import MaxGauge, { bandFor, formatResetsIn } from "./MaxGauge";

const FUTURE = new Date(Date.now() + 3 * 60 * 60 * 1000 + 12 * 60 * 1000);

test("bandFor classifies thresholds", () => {
  expect(bandFor(0)).toBe("ok");
  expect(bandFor(74)).toBe("ok");
  expect(bandFor(75)).toBe("warn");
  expect(bandFor(89)).toBe("warn");
  expect(bandFor(90)).toBe("err");
  expect(bandFor(100)).toBe("err");
});

test("formatResetsIn handles hours+minutes, minutes only, and past", () => {
  const now = new Date("2026-04-26T00:00:00Z");
  expect(formatResetsIn(now, new Date("2026-04-26T03:12:00Z"))).toBe("resets in 3h 12m");
  expect(formatResetsIn(now, new Date("2026-04-26T00:25:00Z"))).toBe("resets in 25m");
  expect(formatResetsIn(now, new Date("2026-04-25T23:00:00Z"))).toBe("resets now");
});

test("compact size renders only percentage label, no header/resets", () => {
  const { container } = render(<MaxGauge usedPct={62} resetsAt={FUTURE} />);
  const root = container.querySelector(`[data-size="compact"]`)!;
  expect(root).not.toBeNull();
  expect(container.querySelector(`[data-part="header"]`)).toBeNull();
  expect(container.querySelector(`[data-part="resets"]`)).toBeNull();
  expect(screen.getByText("62%")).toBeInTheDocument();
});

test("expanded size renders header, band stops, and resets countdown", () => {
  const { container } = render(<MaxGauge usedPct={62} resetsAt={FUTURE} size="expanded" />);
  expect(container.querySelector(`[data-size="expanded"]`)).not.toBeNull();
  expect(container.querySelector(`[data-part="header"]`)).not.toBeNull();
  expect(container.querySelectorAll(`[data-part="band-stop"]`).length).toBe(2);
  expect(container.querySelector(`[data-stop="warn"]`)).not.toBeNull();
  expect(container.querySelector(`[data-stop="err"]`)).not.toBeNull();
  const resets = container.querySelector(`[data-part="resets"]`)!;
  expect(resets.textContent).toMatch(/resets in/);
});

test("default size is compact", () => {
  const { container } = render(<MaxGauge usedPct={10} resetsAt={FUTURE} />);
  expect(container.querySelector(`[data-size="compact"]`)).not.toBeNull();
});

test.each([
  [50, "ok"],
  [74, "ok"],
  [75, "warn"],
  [89, "warn"],
  [90, "err"],
  [99, "err"],
])("usedPct=%i maps to band=%s", (pct, band) => {
  const { container } = render(<MaxGauge usedPct={pct} resetsAt={FUTURE} />);
  expect(container.querySelector(`[data-band="${band}"]`)).not.toBeNull();
});

test("clamps usedPct below 0 and above 100", () => {
  const { container, rerender } = render(<MaxGauge usedPct={-25} resetsAt={FUTURE} />);
  let root = container.querySelector(`[data-pct]`)!;
  expect(root.getAttribute("data-pct")).toBe("0");
  rerender(<MaxGauge usedPct={250} resetsAt={FUTURE} />);
  root = container.querySelector(`[data-pct]`)!;
  expect(root.getAttribute("data-pct")).toBe("100");
});

test("aria-meter exposes value, min, max, and label", () => {
  render(<MaxGauge usedPct={62} resetsAt={FUTURE} />);
  const meter = screen.getByRole("meter", { name: /max-window headroom/i });
  expect(meter.getAttribute("aria-valuenow")).toBe("62");
  expect(meter.getAttribute("aria-valuemin")).toBe("0");
  expect(meter.getAttribute("aria-valuemax")).toBe("100");
});

test("fill width matches the clamped percent", () => {
  const { container } = render(<MaxGauge usedPct={62} resetsAt={FUTURE} />);
  const fill = container.querySelector(`[data-part="fill"]`) as HTMLElement;
  expect(fill.style.width).toBe("62%");
});

test("ok/warn/err bands use their CSS color tokens for the fill", () => {
  for (const [pct, token] of [
    [50, "var(--ok)"],
    [80, "var(--warn)"],
    [95, "var(--err)"],
  ] as const) {
    const { container, unmount } = render(<MaxGauge usedPct={pct} resetsAt={FUTURE} />);
    const fill = container.querySelector(`[data-part="fill"]`) as HTMLElement;
    expect(fill.style.background).toContain(token);
    unmount();
  }
});

test("rounds fractional usedPct in the displayed label", () => {
  render(<MaxGauge usedPct={61.6} resetsAt={FUTURE} />);
  expect(screen.getByText("62%")).toBeInTheDocument();
});

test("expanded variant renders the percentage in the header", () => {
  const { container } = render(<MaxGauge usedPct={42} resetsAt={FUTURE} size="expanded" />);
  const header = container.querySelector(`[data-part="header"]`)!;
  expect(header.textContent).toContain("Max-window");
  expect(header.textContent).toContain("42%");
});
