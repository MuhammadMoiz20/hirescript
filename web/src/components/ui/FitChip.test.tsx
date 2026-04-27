import { render, screen } from "@testing-library/react";
import FitChip, { bandFor } from "./FitChip";

test("score >= 85 renders strong band", () => {
  const { container } = render(<FitChip score={92} />);
  expect(screen.getByText("92")).toBeInTheDocument();
  expect(container.querySelector(`[data-band="strong"]`)).not.toBeNull();
});

test("score == 85 boundary is strong", () => {
  const { container } = render(<FitChip score={85} />);
  expect(container.querySelector(`[data-band="strong"]`)).not.toBeNull();
});

test("score in 60..84 renders moderate band", () => {
  const { container } = render(<FitChip score={72} />);
  expect(screen.getByText("72")).toBeInTheDocument();
  expect(container.querySelector(`[data-band="moderate"]`)).not.toBeNull();
});

test("score == 60 boundary is moderate", () => {
  const { container } = render(<FitChip score={60} />);
  expect(container.querySelector(`[data-band="moderate"]`)).not.toBeNull();
});

test("score in 40..59 renders weak band", () => {
  const { container } = render(<FitChip score={50} />);
  expect(screen.getByText("50")).toBeInTheDocument();
  expect(container.querySelector(`[data-band="weak"]`)).not.toBeNull();
});

test("score == 40 boundary is weak", () => {
  const { container } = render(<FitChip score={40} />);
  expect(container.querySelector(`[data-band="weak"]`)).not.toBeNull();
});

test("score < 40 renders muted band", () => {
  const { container } = render(<FitChip score={12} />);
  expect(screen.getByText("12")).toBeInTheDocument();
  expect(container.querySelector(`[data-band="muted"]`)).not.toBeNull();
});

test("null score renders unknown band with em-dash", () => {
  const { container } = render(<FitChip score={null} />);
  expect(screen.getByText("—")).toBeInTheDocument();
  expect(container.querySelector(`[data-band="unknown"]`)).not.toBeNull();
});

test("renders /100 suffix in all numeric bands", () => {
  const { container } = render(<FitChip score={75} />);
  // /100 is a separate span; assert via text content of root
  const root = container.querySelector(`[data-band]`)!;
  expect(root.textContent).toContain("/100");
});

test("supports compact and spacious sizes", () => {
  for (const size of ["sm", "lg"] as const) {
    const { container, unmount } = render(<FitChip score={80} size={size} />);
    expect(container.querySelector(`[data-size="${size}"]`)).not.toBeNull();
    unmount();
  }
});

test("uses ok color tokens for strong band", () => {
  const { container } = render(<FitChip score={90} />);
  const el = container.querySelector(`[data-band="strong"]`) as HTMLElement;
  expect(el.style.color).toContain("var(--ok)");
  expect(el.style.background).toContain("var(--ok-soft)");
});

test("uses warn color tokens for moderate band", () => {
  const { container } = render(<FitChip score={70} />);
  const el = container.querySelector(`[data-band="moderate"]`) as HTMLElement;
  expect(el.style.color).toContain("var(--warn)");
});

test("bandFor pure helper covers all branches", () => {
  expect(bandFor(100)).toBe("strong");
  expect(bandFor(85)).toBe("strong");
  expect(bandFor(84)).toBe("moderate");
  expect(bandFor(60)).toBe("moderate");
  expect(bandFor(59)).toBe("weak");
  expect(bandFor(40)).toBe("weak");
  expect(bandFor(39)).toBe("muted");
  expect(bandFor(0)).toBe("muted");
  expect(bandFor(null)).toBe("unknown");
  expect(bandFor(NaN)).toBe("unknown");
});

test("rounds fractional scores", () => {
  render(<FitChip score={87.6} />);
  expect(screen.getByText("88")).toBeInTheDocument();
});
