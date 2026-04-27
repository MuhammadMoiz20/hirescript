import { render, screen } from "@testing-library/react";
import CompileChip from "./CompileChip";

test("renders done state with iter, tokens, wall ms and page count", () => {
  render(
    <CompileChip
      model="haiku"
      iterations={2}
      tokensCached={1000}
      tokensFresh={250}
      wallMs={1800}
      pageCount={1}
    />
  );
  expect(screen.getByText("Haiku 4.5")).toBeInTheDocument();
  expect(screen.getByText(/iter 2/)).toBeInTheDocument();
  expect(screen.getByText(/1,000 cached/)).toBeInTheDocument();
  expect(screen.getByText(/250 fresh/)).toBeInTheDocument();
  expect(screen.getByText(/1\.8s/)).toBeInTheDocument();
});

test("renders compiling state", () => {
  render(<CompileChip kind="compiling" />);
  const chip = screen.getAllByRole("status").find((el) => el.getAttribute("data-kind") === "compiling");
  expect(chip).toBeDefined();
  expect(chip!).toHaveTextContent(/compiling/i);
});

test("renders queued state", () => {
  render(<CompileChip kind="queued" />);
  const chip = screen.getByText(/queued/i).closest("[data-kind]");
  expect(chip).toHaveAttribute("data-kind", "queued");
});

test("renders failed state", () => {
  render(<CompileChip kind="failed" />);
  const chip = screen.getByText(/failed/i).closest("[data-kind]");
  expect(chip).toHaveAttribute("data-kind", "failed");
});

test("renders ok kind as receipt with model", () => {
  render(<CompileChip kind="ok" model="sonnet" iterations={1} wallMs={900} />);
  expect(screen.getByText("Sonnet 4.6")).toBeInTheDocument();
  expect(screen.getByText(/iter 1/)).toBeInTheDocument();
  expect(screen.getByText(/0\.9s/)).toBeInTheDocument();
});
