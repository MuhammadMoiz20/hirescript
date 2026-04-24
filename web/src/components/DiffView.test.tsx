import { vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DiffView from "./DiffView";

const defaultProps = {
  currentLatex: "old line\n",
  proposedLatex: "new line\n",
  pageCount: 1,
  enforced: true,
  removedTerms: [],
  onAccept: () => {},
  onReject: () => {},
};

test("shows green 1-page badge when enforced", () => {
  render(<DiffView {...defaultProps} />);
  expect(screen.getByText(/1 page/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /accept/i })).not.toBeDisabled();
});

test("disables accept when not enforced", () => {
  render(<DiffView {...defaultProps} pageCount={2} enforced={false} />);
  expect(screen.getByText(/2 page/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /accept/i })).toBeDisabled();
});

test("calls onAccept when accept clicked", () => {
  const onAccept = vi.fn();
  render(<DiffView {...defaultProps} onAccept={onAccept} />);
  fireEvent.click(screen.getByRole("button", { name: /accept/i }));
  expect(onAccept).toHaveBeenCalled();
});

test("calls onReject when reject clicked", () => {
  const onReject = vi.fn();
  render(<DiffView {...defaultProps} onReject={onReject} />);
  fireEvent.click(screen.getByRole("button", { name: /reject/i }));
  expect(onReject).toHaveBeenCalled();
});

test("renders removed-terms callout when present", () => {
  render(<DiffView {...defaultProps} removedTerms={["led", "shipped"]} />);
  expect(screen.getByText(/removed protected terms/i)).toBeInTheDocument();
  expect(screen.getByText("led")).toBeInTheDocument();
  expect(screen.getByText("shipped")).toBeInTheDocument();
});

test("renders some indication of changes", () => {
  render(<DiffView {...defaultProps} currentLatex="alpha\n" proposedLatex="beta\n" />);
  expect(screen.getByText(/alpha/)).toBeInTheDocument();
  expect(screen.getByText(/beta/)).toBeInTheDocument();
});
