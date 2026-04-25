import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import TermPill from "./TermPill";

test("renders preserved term and remove handler", () => {
  const onRemove = vi.fn();
  render(<TermPill onRemove={onRemove}>Postgres</TermPill>);
  expect(screen.getByText("Postgres")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Remove"));
  expect(onRemove).toHaveBeenCalled();
});
