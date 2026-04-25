import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "../ThemeProvider";
import TopChrome from "./TopChrome";

test("renders wordmark and theme toggle", () => {
  localStorage.removeItem("hs-theme");
  render(
    <ThemeProvider>
      <TopChrome>Library / Master</TopChrome>
    </ThemeProvider>
  );
  expect(screen.getByText("HireScript")).toBeInTheDocument();
  expect(screen.getByText(/Library/)).toBeInTheDocument();
  const toggle = screen.getByLabelText("Toggle theme");
  fireEvent.click(toggle);
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});
