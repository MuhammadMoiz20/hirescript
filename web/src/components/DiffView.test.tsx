import { vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DiffView from "./DiffView";

const defaultProps = {
  currentLatex: "old line\n",
  proposedLatex: "new line\n",
  pageCount: 1,
  enforced: true,
  removedTerms: [],
  onAccept: () => {},
  onReject: () => {},
};

test("shows green 1-page badge when enforced", () => {
  render(<DiffView {...defaultProps} />);
  expect(screen.getAllByText(/1 page/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /accept/i })).not.toBeDisabled();
});

test("disables accept when not enforced", () => {
  render(<DiffView {...defaultProps} pageCount={2} enforced={false} />);
  expect(screen.getAllByText(/2 page/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /accept/i })).toBeDisabled();
});

test("calls onAccept when accept clicked", () => {
  const onAccept = vi.fn();
  render(<DiffView {...defaultProps} onAccept={onAccept} />);
  fireEvent.click(screen.getByRole("button", { name: /accept/i }));
  expect(onAccept).toHaveBeenCalled();
});

test("calls onReject when reject clicked", () => {
  const onReject = vi.fn();
  render(<DiffView {...defaultProps} onReject={onReject} />);
  fireEvent.click(screen.getByRole("button", { name: /reject/i }));
  expect(onReject).toHaveBeenCalled();
});

test("renders removed-terms callout when present", () => {
  render(<DiffView {...defaultProps} removedTerms={["led", "shipped"]} />);
  expect(screen.getByText(/removed protected terms/i)).toBeInTheDocument();
  expect(screen.getByText("led")).toBeInTheDocument();
  expect(screen.getByText("shipped")).toBeInTheDocument();
});

test("renders preserved protected terms in the strip", () => {
  render(
    <DiffView
      {...defaultProps}
      preservedTerms={["idempotent", "SOC2"]}
    />,
  );
  const strip = screen.getByTestId("protected-term-strip");
  expect(strip).toHaveTextContent("idempotent");
  expect(strip).toHaveTextContent("SOC2");
});

test("renders 'none pinned' when no protected terms supplied", () => {
  render(<DiffView {...defaultProps} />);
  expect(screen.getByTestId("protected-term-strip")).toHaveTextContent(/none pinned/i);
});

test("renders some indication of changes", () => {
  render(<DiffView {...defaultProps} currentLatex="alpha\n" proposedLatex="beta\n" />);
  expect(screen.getByText(/alpha/)).toBeInTheDocument();
  expect(screen.getByText(/beta/)).toBeInTheDocument();
});

test("renders numbered hotspots in the gutter for changed regions", () => {
  render(
    <DiffView
      {...defaultProps}
      currentLatex={"a\nb\nc\n"}
      proposedLatex={"a\nB\nc\n"}
    />,
  );
  const hotspot = document.querySelector("[data-hotspot-id]");
  expect(hotspot).not.toBeNull();
  expect(hotspot?.getAttribute("data-hotspot-id")).toBe("1");
});

test("clicking a hotspot fires onHotspotClick with its id", () => {
  const onHotspotClick = vi.fn();
  render(
    <DiffView
      {...defaultProps}
      currentLatex={"a\nb\nc\n"}
      proposedLatex={"a\nB\nc\n"}
      onHotspotClick={onHotspotClick}
    />,
  );
  const hotspot = screen.getByRole("button", { name: /jump to pdf region 1/i });
  fireEvent.click(hotspot);
  expect(onHotspotClick).toHaveBeenCalledWith(1);
});

test("renders compile metadata when model + iterations supplied", () => {
  render(
    <DiffView
      {...defaultProps}
      model="sonnet"
      iterations={2}
      tokensCached={1200}
      tokensFresh={340}
      wallMs={4200}
    />,
  );
  expect(screen.getByText(/Sonnet 4\.6/)).toBeInTheDocument();
  expect(screen.getByText(/iter 2/)).toBeInTheDocument();
  expect(screen.getByText(/4\.2s/)).toBeInTheDocument();
});

test("shows diff size summary in header", () => {
  render(
    <DiffView
      {...defaultProps}
      currentLatex={"a\nb\n"}
      proposedLatex={"a\nB\n"}
    />,
  );
  expect(screen.getByTestId("diff-size")).toHaveTextContent(/2 lines changed/i);
});
