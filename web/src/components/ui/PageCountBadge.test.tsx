import { render, screen } from "@testing-library/react";
import PageCountBadge from "./PageCountBadge";

test("renders 1 page when ok", () => {
  render(<PageCountBadge state="ok" />);
  expect(screen.getByText(/1 page/i)).toBeInTheDocument();
});

test("renders error label", () => {
  render(<PageCountBadge state="err" />);
  expect(screen.getByRole("status").textContent).toMatch(/page/i);
});
