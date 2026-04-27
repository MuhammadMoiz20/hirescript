import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import ProtectedTermPill from "./ProtectedTermPill";

test("renders preserved term and remove handler", () => {
  const onRemove = vi.fn();
  render(<ProtectedTermPill onRemove={onRemove}>Postgres</ProtectedTermPill>);
  expect(screen.getByText("Postgres")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Remove"));
  expect(onRemove).toHaveBeenCalled();
});

test("renders preserved variant by default", () => {
  render(<ProtectedTermPill>FastAPI</ProtectedTermPill>);
  expect(screen.getByText("FastAPI").closest("[data-variant]")).toHaveAttribute("data-variant", "preserved");
});

test("renders removed variant", () => {
  render(<ProtectedTermPill variant="removed">Kotlin</ProtectedTermPill>);
  expect(screen.getByText("Kotlin").closest("[data-variant]")).toHaveAttribute("data-variant", "removed");
});

test("omits remove button when onRemove not supplied", () => {
  render(<ProtectedTermPill>React</ProtectedTermPill>);
  expect(screen.queryByLabelText("Remove")).not.toBeInTheDocument();
});
