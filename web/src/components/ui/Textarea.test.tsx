import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import Textarea from "./Textarea";

test("forwards props and onChange", () => {
  const onChange = vi.fn();
  render(<Textarea placeholder="bio" onChange={onChange} />);
  const el = screen.getByPlaceholderText("bio") as HTMLTextAreaElement;
  fireEvent.change(el, { target: { value: "hello" } });
  expect(onChange).toHaveBeenCalled();
});
