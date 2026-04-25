import { render } from "@testing-library/react";
import Glyph from "./Glyph";

test("renders an svg for known name", () => {
  const { container } = render(<Glyph name="check" />);
  const svg = container.querySelector("svg");
  expect(svg).not.toBeNull();
  expect(svg?.getAttribute("width")).toBe("14");
});
