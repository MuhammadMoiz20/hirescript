import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBanner from "./ErrorBanner";

describe("ErrorBanner", () => {
  it("renders the message and exposes alert role", () => {
    render(<ErrorBanner message="Failed to load postings" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Failed to load postings");
  });

  it("fires retry handler when Retry is clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="boom" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("fires dismiss handler when Dismiss is clicked", () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner message="boom" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
