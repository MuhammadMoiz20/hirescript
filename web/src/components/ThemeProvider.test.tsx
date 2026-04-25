import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function Probe() {
  const { theme, toggle } = useTheme();
  return <button onClick={toggle}>{theme}</button>;
}

test("default theme is light and toggles", () => {
  localStorage.removeItem("hs-theme");
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByRole("button").textContent).toBe("light");
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("button").textContent).toBe("dark");
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

test("persists choice to localStorage", () => {
  localStorage.setItem("hs-theme", "dark");
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByRole("button").textContent).toBe("dark");
});
