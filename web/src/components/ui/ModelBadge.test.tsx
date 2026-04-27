import { render, screen } from "@testing-library/react";
import ModelBadge from "./ModelBadge";

test("renders haiku label", () => {
  render(<ModelBadge model="haiku" />);
  expect(screen.getByText("Haiku 4.5")).toBeInTheDocument();
});

test("renders sonnet label", () => {
  render(<ModelBadge model="sonnet" />);
  expect(screen.getByText("Sonnet 4.6")).toBeInTheDocument();
});

test("renders opus label", () => {
  render(<ModelBadge model="opus" />);
  expect(screen.getByText("Opus 4.7")).toBeInTheDocument();
});

test("supports sm and md sizes", () => {
  const { rerender } = render(<ModelBadge model="haiku" size="sm" />);
  expect(screen.getByText("Haiku 4.5")).toBeInTheDocument();
  rerender(<ModelBadge model="haiku" size="md" />);
  expect(screen.getByText("Haiku 4.5")).toBeInTheDocument();
});
