import { render, screen } from "@testing-library/react";
import ModelBadge from "./ModelBadge";

test("renders haiku label", () => {
  render(<ModelBadge model="haiku" />);
  expect(screen.getByText("Haiku 4.5")).toBeInTheDocument();
});
