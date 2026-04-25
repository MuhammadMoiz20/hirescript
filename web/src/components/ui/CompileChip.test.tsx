import { render, screen } from "@testing-library/react";
import CompileChip from "./CompileChip";

test("renders done state with iter and wall ms", () => {
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
  expect(screen.getByText(/1\.8s/)).toBeInTheDocument();
});

test("renders compiling state", () => {
  render(<CompileChip kind="compiling" />);
  expect(screen.getByText(/compiling/i)).toBeInTheDocument();
});
