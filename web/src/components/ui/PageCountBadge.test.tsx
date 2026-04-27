import { render, screen } from "@testing-library/react";
import PageCountBadge, { PageCountState } from "./PageCountBadge";

test("renders 1 page when ok", () => {
  render(<PageCountBadge state="ok" />);
  expect(screen.getByText(/1 page/i)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("data-state", "ok");
});

test("renders ok for numeric state 1", () => {
  render(<PageCountBadge state={1} />);
  expect(screen.getByText(/1 page/i)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("data-state", "ok");
});

test("renders over state with explicit page count", () => {
  render(<PageCountBadge state={3} />);
  expect(screen.getByText(/3 pages/i)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("data-state", "over");
});

test("renders over state with string token", () => {
  render(<PageCountBadge state="over" />);
  expect(screen.getByText(/over 1 page/i)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("data-state", "over");
});

test("renders compiling state", () => {
  render(<PageCountBadge state="compiling" />);
  expect(screen.getByText(/compiling/i)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("data-state", "compiling");
});

test("renders error state", () => {
  render(<PageCountBadge state="error" />);
  expect(screen.getByText(/compile error/i)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("data-state", "error");
});

test("renders unknown state", () => {
  render(<PageCountBadge state="unknown" />);
  expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("data-state", "unknown");
});

test("renders final state", () => {
  render(<PageCountBadge state="final" />);
  expect(screen.getByText(/final/i)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("data-state", "final");
});

test("supports each size without crashing", () => {
  for (const size of ["sm", "md", "lg"] as const) {
    const { unmount } = render(<PageCountBadge state={1} size={size} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    unmount();
  }
});

test("hides label when showLabel is false", () => {
  render(<PageCountBadge state={1} showLabel={false} />);
  expect(screen.queryByText(/1 page/i)).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toBeInTheDocument();
});

test("legacy err alias maps to over", () => {
  // "err" remains accepted for back-compat with earlier callsites.
  const state: PageCountState = "err";
  render(<PageCountBadge state={state} />);
  expect(screen.getByRole("status")).toHaveAttribute("data-state", "over");
});
