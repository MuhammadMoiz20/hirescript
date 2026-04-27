import { render, screen } from "@testing-library/react";
import Sparkline from "./Sparkline";

const FOURTEEN = [3, 5, 2, 4, 7, 6, 8, 5, 4, 9, 11, 8, 6, 7];

test("renders an SVG with role=img and an aria-label", () => {
  render(<Sparkline data={FOURTEEN} />);
  const svg = screen.getByRole("img");
  expect(svg.tagName.toLowerCase()).toBe("svg");
  expect(svg.getAttribute("aria-label")).toMatch(/applied jobs over the last 14 days/i);
  expect(svg.getAttribute("aria-label")).toContain("85"); // total
});

test("draws a polyline path and an end-dot for the latest point", () => {
  const { container } = render(<Sparkline data={FOURTEEN} />);
  const line = container.querySelector(`[data-part="line"]`);
  const dot = container.querySelector(`[data-part="dot"]`);
  expect(line).not.toBeNull();
  expect(dot).not.toBeNull();
  expect(line!.getAttribute("d")).toMatch(/^M /);
  // 14 points → 13 line segments
  expect((line!.getAttribute("d")!.match(/L /g) || []).length).toBe(13);
});

test("fill=true renders the soft area path; default omits it", () => {
  const { container, rerender } = render(<Sparkline data={FOURTEEN} />);
  expect(container.querySelector(`[data-part="fill"]`)).toBeNull();
  rerender(<Sparkline data={FOURTEEN} fill />);
  expect(container.querySelector(`[data-part="fill"]`)).not.toBeNull();
});

test("respects custom width/height and exposes data-points", () => {
  const { container } = render(<Sparkline data={FOURTEEN} width={200} height={40} />);
  const svg = container.querySelector("svg")!;
  expect(svg.getAttribute("width")).toBe("200");
  expect(svg.getAttribute("height")).toBe("40");
  expect(svg.getAttribute("viewBox")).toBe("0 0 200 40");
  expect(svg.getAttribute("data-points")).toBe("14");
});

test("custom ariaLabel overrides the default", () => {
  render(<Sparkline data={FOURTEEN} ariaLabel="Last 14 days of applies" />);
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
    "Last 14 days of applies",
  );
});

test("min/max data attributes reflect series range", () => {
  const { container } = render(<Sparkline data={FOURTEEN} />);
  const svg = container.querySelector("svg")!;
  expect(svg.getAttribute("data-min")).toBe("2");
  expect(svg.getAttribute("data-max")).toBe("11");
});

test("flat series (all equal) renders without NaN coordinates", () => {
  const flat = new Array(14).fill(4);
  const { container } = render(<Sparkline data={flat} />);
  const d = container.querySelector(`[data-part="line"]`)!.getAttribute("d")!;
  expect(d).not.toMatch(/NaN/);
});

test("single-point series places the dot at horizontal center", () => {
  const { container } = render(<Sparkline data={[5]} width={100} height={20} />);
  const dot = container.querySelector(`[data-part="dot"]`)!;
  expect(dot.getAttribute("cx")).toBe("50");
});

test("empty data renders a labeled empty SVG with no line/dot", () => {
  const { container } = render(<Sparkline data={[]} />);
  const svg = container.querySelector("svg")!;
  expect(svg.getAttribute("data-empty")).toBe("true");
  expect(svg.getAttribute("aria-label")).toMatch(/no sparkline data/i);
  expect(container.querySelector(`[data-part="line"]`)).toBeNull();
  expect(container.querySelector(`[data-part="dot"]`)).toBeNull();
});

test("uses the provided stroke color on line and dot", () => {
  const { container } = render(<Sparkline data={FOURTEEN} stroke="var(--ok)" />);
  const line = container.querySelector(`[data-part="line"]`)!;
  const dot = container.querySelector(`[data-part="dot"]`)!;
  expect(line.getAttribute("stroke")).toBe("var(--ok)");
  expect(dot.getAttribute("fill")).toBe("var(--ok)");
});

test("default stroke is var(--ink-2)", () => {
  const { container } = render(<Sparkline data={FOURTEEN} />);
  expect(container.querySelector(`[data-part="line"]`)!.getAttribute("stroke")).toBe(
    "var(--ink-2)",
  );
});

test("end dot is at the last point's coordinates", () => {
  const { container } = render(<Sparkline data={FOURTEEN} width={140} height={30} />);
  const line = container.querySelector(`[data-part="line"]`)!;
  const dot = container.querySelector(`[data-part="dot"]`)!;
  const segs = line.getAttribute("d")!.split(" L ");
  const lastSeg = segs[segs.length - 1];
  const [lx, ly] = lastSeg.split(",").map(Number);
  expect(Number(dot.getAttribute("cx"))).toBeCloseTo(lx, 2);
  expect(Number(dot.getAttribute("cy"))).toBeCloseTo(ly, 2);
});
