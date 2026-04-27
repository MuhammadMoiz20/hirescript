import { render, screen, fireEvent } from "@testing-library/react";
import ModeToggle, { Mode } from "./ModeToggle";

const MODES: Mode[] = ["A", "B"];

test.each(MODES)("renders mode %s with active side highlighted", (mode) => {
  const { container } = render(<ModeToggle mode={mode} />);
  const root = container.querySelector(`[data-mode="${mode}"]`);
  expect(root).not.toBeNull();
  const active = container.querySelector(`[data-side="${mode}"]`) as HTMLElement;
  expect(active.getAttribute("data-active")).toBe("true");
  expect(active.getAttribute("aria-pressed")).toBe("true");
  // Filled side: ink background, paper foreground
  expect(active.style.background).toContain("var(--ink)");
  expect(active.style.color).toContain("var(--paper)");
});

test.each(MODES)("inactive side is not filled for mode %s", (mode) => {
  const other: Mode = mode === "A" ? "B" : "A";
  const { container } = render(<ModeToggle mode={mode} />);
  const inactive = container.querySelector(`[data-side="${other}"]`) as HTMLElement;
  expect(inactive.getAttribute("data-active")).toBe("false");
  expect(inactive.getAttribute("aria-pressed")).toBe("false");
  expect(inactive.style.background).toContain("transparent");
});

test("renders both A and B sides with their glyphs/labels", () => {
  render(<ModeToggle mode="A" />);
  expect(screen.getByLabelText("Mode A")).toBeInTheDocument();
  expect(screen.getByLabelText("Mode B")).toBeInTheDocument();
  // Labels visible
  expect(screen.getByLabelText("Mode A").textContent).toContain("A");
  expect(screen.getByLabelText("Mode B").textContent).toContain("B");
});

test("override=true bolds the active label (font-weight 700)", () => {
  const { container } = render(<ModeToggle mode="A" override />);
  const root = container.querySelector(`[data-mode="A"]`)!;
  expect(root.getAttribute("data-override")).toBe("true");
  const active = container.querySelector(`[data-side="A"]`) as HTMLElement;
  expect(active.style.fontWeight).toBe("700");
});

test("override=false uses medium weight (500) on active side", () => {
  const { container } = render(<ModeToggle mode="A" />);
  const root = container.querySelector(`[data-mode="A"]`)!;
  expect(root.getAttribute("data-override")).toBe("false");
  const active = container.querySelector(`[data-side="A"]`) as HTMLElement;
  expect(active.style.fontWeight).toBe("500");
});

test("inactive side uses regular weight (400)", () => {
  const { container } = render(<ModeToggle mode="A" override />);
  const inactive = container.querySelector(`[data-side="B"]`) as HTMLElement;
  expect(inactive.style.fontWeight).toBe("400");
});

test("clicking a side calls onChange with that mode", () => {
  const onChange = vi.fn();
  render(<ModeToggle mode="A" onChange={onChange} />);
  fireEvent.click(screen.getByLabelText("Mode B"));
  expect(onChange).toHaveBeenCalledWith("B");
  fireEvent.click(screen.getByLabelText("Mode A"));
  expect(onChange).toHaveBeenCalledWith("A");
});

test("disabled prevents onChange and renders read-only", () => {
  const onChange = vi.fn();
  const { container } = render(<ModeToggle mode="A" disabled onChange={onChange} />);
  expect(container.querySelector(`[data-disabled="true"]`)).not.toBeNull();
  const sideB = screen.getByLabelText("Mode B") as HTMLButtonElement;
  expect(sideB.disabled).toBe(true);
  fireEvent.click(sideB);
  expect(onChange).not.toHaveBeenCalled();
});

test("without onChange, sides are non-interactive but still render", () => {
  render(<ModeToggle mode="A" />);
  // No throw clicking with no handler.
  fireEvent.click(screen.getByLabelText("Mode B"));
});

test("supports compact and spacious sizes", () => {
  for (const size of ["sm", "lg"] as const) {
    const { container, unmount } = render(<ModeToggle mode="A" size={size} />);
    expect(container.querySelector(`[data-size="${size}"]`)).not.toBeNull();
    unmount();
  }
});

test("default size is compact (sm)", () => {
  const { container } = render(<ModeToggle mode="A" />);
  expect(container.querySelector(`[data-size="sm"]`)).not.toBeNull();
});

test("title reflects override + disabled state", () => {
  const { container, rerender } = render(<ModeToggle mode="A" />);
  let root = container.querySelector(`[data-mode="A"]`)!;
  expect(root.getAttribute("title")).toContain("tier default");
  rerender(<ModeToggle mode="A" override />);
  root = container.querySelector(`[data-mode="A"]`)!;
  expect(root.getAttribute("title")).toContain("override");
  rerender(<ModeToggle mode="B" disabled />);
  root = container.querySelector(`[data-mode="B"]`)!;
  expect(root.getAttribute("title")).toContain("read-only");
});

test("group has role=group and accessible label", () => {
  render(<ModeToggle mode="A" />);
  expect(screen.getByRole("group", { name: /mode toggle/i })).toBeInTheDocument();
});
