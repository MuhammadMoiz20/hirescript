import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import OverflowBanner from "./OverflowBanner";

test("hidden when pageCount <= 1", () => {
  const { container } = render(<OverflowBanner pageCount={1} onTighten={() => {}} />);
  expect(container.firstChild).toBeNull();
});

test("renders banner when pageCount > 1", () => {
  render(<OverflowBanner pageCount={2} onTighten={() => {}} />);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByText(/2 page/)).toBeInTheDocument();
});

test("calls onTighten when button clicked", () => {
  const onTighten = vi.fn();
  render(<OverflowBanner pageCount={3} onTighten={onTighten} />);
  fireEvent.click(screen.getByRole("button", { name: /ask claude to tighten/i }));
  expect(onTighten).toHaveBeenCalled();
});

test("disables button while busy", () => {
  render(<OverflowBanner pageCount={2} onTighten={() => {}} busy={true} />);
  expect(screen.getByRole("button", { name: /tightening/i })).toBeDisabled();
});
