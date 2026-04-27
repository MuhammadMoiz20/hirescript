import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LoadingSkeleton from "./LoadingSkeleton";

describe("LoadingSkeleton", () => {
  it("renders the requested number of rows", () => {
    render(<LoadingSkeleton rows={5} testid="skel" />);
    const root = screen.getByTestId("skel");
    expect(root).toHaveAttribute("aria-label", "Loading");
    expect(root.children.length).toBe(5);
  });

  it("defaults to 3 rows", () => {
    render(<LoadingSkeleton testid="skel" />);
    expect(screen.getByTestId("skel").children.length).toBe(3);
  });
});
