import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import MobileTabBar, { MobileTab } from "./MobileTabBar";

describe("MobileTabBar", () => {
  it("renders 4 tabs and calls onChange", () => {
    const onChange = vi.fn();
    render(<MobileTabBar value="edit" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /preview/i }));
    expect(onChange).toHaveBeenCalledWith<[MobileTab]>("preview");
  });

  it("marks the active tab aria-selected", () => {
    render(<MobileTabBar value="chat" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: /chat/i })).toHaveAttribute("aria-selected", "true");
  });
});
