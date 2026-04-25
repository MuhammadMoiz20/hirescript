import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import Input from "./Input";

test("forwards props and onChange", () => {
  const onChange = vi.fn();
  render(<Input placeholder="name" onChange={onChange} />);
  const el = screen.getByPlaceholderText("name") as HTMLInputElement;
  fireEvent.change(el, { target: { value: "Maya" } });
  expect(onChange).toHaveBeenCalled();
});
