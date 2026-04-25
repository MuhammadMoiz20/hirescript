import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import Button from "./Button";

test("renders text and handles click", () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Save</Button>);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onClick).toHaveBeenCalled();
});

test("applies primary variant", () => {
  render(<Button variant="primary">Go</Button>);
  expect(screen.getByRole("button").getAttribute("data-variant")).toBe("primary");
});
