import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EmptyState from "./EmptyState";

describe("EmptyState", () => {
  it("renders title and body", () => {
    render(<EmptyState title="Nothing in queue" body="The agent is idle." />);
    expect(screen.getByText("Nothing in queue")).toBeInTheDocument();
    expect(screen.getByText("The agent is idle.")).toBeInTheDocument();
  });

  it("renders cta and fires onClick", () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No KB documents yet"
        body="Connect Notion."
        cta={{ label: "Connect a source", onClick }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect a source" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("supports inline variant", () => {
    render(<EmptyState title="All caught up" variant="inline" testid="es" />);
    expect(screen.getByTestId("es")).toBeInTheDocument();
  });
});
