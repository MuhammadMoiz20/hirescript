import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ChatDrawer from "./ChatDrawer";

describe("ChatDrawer", () => {
  it("renders children when open and calls onClose on backdrop click", () => {
    const onClose = vi.fn();
    render(<ChatDrawer open onClose={onClose}><div>chat</div></ChatDrawer>);
    expect(screen.getByText("chat")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chat-drawer-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    render(<ChatDrawer open={false} onClose={() => {}}><div>chat</div></ChatDrawer>);
    expect(screen.queryByText("chat")).toBeNull();
  });
});
