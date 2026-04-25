import { fireEvent, render, screen } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function mockOsTheme(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes("dark") ? dark : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  } as MediaQueryList));
}

function Probe() {
  const { theme, toggle } = useTheme();
  return <button onClick={toggle}>{theme}</button>;
}

beforeEach(() => {
  localStorage.clear();
  mockOsTheme(false);
});

test("default theme follows OS light when no stored value", () => {
  mockOsTheme(false);
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByRole("button").textContent).toBe("light");
});

test("default theme follows OS dark when no stored value", () => {
  mockOsTheme(true);
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByRole("button").textContent).toBe("dark");
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

test("toggle flips and persists to localStorage", () => {
  mockOsTheme(false);
  render(<ThemeProvider><Probe /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("button").textContent).toBe("dark");
  expect(localStorage.getItem("hs-theme")).toBe("dark");
});

test("stored value overrides OS preference", () => {
  localStorage.setItem("hs-theme", "light");
  mockOsTheme(true);
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByRole("button").textContent).toBe("light");
});
