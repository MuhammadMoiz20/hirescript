import { render, screen } from "@testing-library/react";
import StatusPill, { STATUS_META, StatusKind } from "./StatusPill";

const ALL_STATUSES: StatusKind[] = [
  "queued",
  "running",
  "ok",
  "failed",
  "cancelled",
  "paused",
  "stuck",
  "errored",
  "prepared",
  "submitted",
  "duplicate_skipped",
];

test("STATUS_META covers exactly the 11 plan states", () => {
  expect(Object.keys(STATUS_META).sort()).toEqual([...ALL_STATUSES].sort());
});

test.each(ALL_STATUSES)("renders %s status with label, glyph, and data-status", (status) => {
  const { container } = render(<StatusPill status={status} />);
  const el = container.querySelector(`[data-status="${status}"]`) as HTMLElement;
  expect(el).not.toBeNull();
  expect(el.getAttribute("role")).toBe("status");
  // Label visible.
  expect(el.textContent).toContain(STATUS_META[status].label);
  // Glyph rendered (in textContent, prefix).
  expect(el.textContent).toContain(STATUS_META[status].glyph);
});

test.each(ALL_STATUSES)("uses color token var(--%s-derived) on %s", (status) => {
  const { container } = render(<StatusPill status={status} />);
  const el = container.querySelector(`[data-status="${status}"]`) as HTMLElement;
  const expectedColor = `var(--${STATUS_META[status].color})`;
  expect(el.style.color).toContain(expectedColor);
  expect(el.style.border).toContain(expectedColor);
});

test("running status uses an animated glyph", () => {
  const { container } = render(<StatusPill status="running" />);
  const el = container.querySelector(`[data-status="running"]`)!;
  const glyph = el.querySelector("span") as HTMLElement;
  expect(glyph.style.animation).toContain("blink");
});

test("non-running statuses do not animate", () => {
  const { container } = render(<StatusPill status="ok" />);
  const el = container.querySelector(`[data-status="ok"]`)!;
  const glyph = el.querySelector("span") as HTMLElement;
  expect(glyph.style.animation).toBe("none");
});

test("supports compact and spacious sizes", () => {
  for (const size of ["sm", "lg"] as const) {
    const { container, unmount } = render(<StatusPill status="queued" size={size} />);
    expect(container.querySelector(`[data-size="${size}"]`)).not.toBeNull();
    unmount();
  }
});

test("default size is compact (sm)", () => {
  const { container } = render(<StatusPill status="queued" />);
  expect(container.querySelector(`[data-size="sm"]`)).not.toBeNull();
});

test("renders nothing for an unknown status", () => {
  // Cast through unknown to bypass TS while testing runtime safety.
  const { container } = render(
    <StatusPill status={"bogus" as unknown as StatusKind} />,
  );
  expect(container.firstChild).toBeNull();
});

test("label uses the mono font family", () => {
  const { container } = render(<StatusPill status="ok" />);
  const el = container.querySelector(`[data-status="ok"]`) as HTMLElement;
  expect(el.style.fontFamily).toContain("var(--f-mono)");
});

test("smoke: each status renders its visible label text via screen", () => {
  for (const status of ALL_STATUSES) {
    const { unmount } = render(<StatusPill status={status} />);
    expect(screen.getByText(STATUS_META[status].label)).toBeInTheDocument();
    unmount();
  }
});
