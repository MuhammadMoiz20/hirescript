import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import TopBar from "./TopBar";

const FUTURE = new Date(Date.now() + 2 * 60 * 60 * 1000);

function setup(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  const props = {
    breadcrumb: { section: "Per-job", route: "Editor" },
    onBreadcrumbClick: vi.fn(),
    maxGaugeProps: { usedPct: 42, resetsAt: FUTURE },
    theme: "light" as const,
    onToggleTheme: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    unreadCount: 0,
    onOpenNotifications: vi.fn(),
    ...overrides,
  };
  const utils = render(<TopBar {...props} />);
  return { ...utils, props };
}

test("renders wordmark, breadcrumb section, and MaxGauge meter", () => {
  setup();
  expect(screen.getByText("HireScript")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Per-job/ })).toBeInTheDocument();
  expect(screen.getByText("Editor")).toBeInTheDocument();
  expect(screen.getByRole("meter", { name: /Max-window/ })).toBeInTheDocument();
});

test("clicking wordmark fires onBreadcrumbClick('root')", () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole("button", { name: /HireScript/ }));
  expect(props.onBreadcrumbClick).toHaveBeenCalledWith("root");
});

test("clicking section breadcrumb fires onBreadcrumbClick('section')", () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole("button", { name: /Per-job/ }));
  expect(props.onBreadcrumbClick).toHaveBeenCalledWith("section");
});

test("clicking the ⌘K trigger fires onOpenCommandPalette", () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole("button", { name: /command palette/i }));
  expect(props.onOpenCommandPalette).toHaveBeenCalledTimes(1);
});

test("Meta+K global keypress fires onOpenCommandPalette and prevents default", () => {
  const { props } = setup();
  const ev = new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true });
  const prevented = !window.dispatchEvent(ev);
  expect(props.onOpenCommandPalette).toHaveBeenCalledTimes(1);
  expect(prevented).toBe(true);
});

test("Ctrl+K global keypress also fires onOpenCommandPalette", () => {
  const { props } = setup();
  fireEvent.keyDown(window, { key: "K", ctrlKey: true });
  expect(props.onOpenCommandPalette).toHaveBeenCalledTimes(1);
});

test("clicking theme toggle fires onToggleTheme", () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole("button", { name: /theme/i }));
  expect(props.onToggleTheme).toHaveBeenCalledTimes(1);
});

test("clicking notifications bell fires onOpenNotifications", () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
  expect(props.onOpenNotifications).toHaveBeenCalledTimes(1);
});

test("unread count > 0 renders chip; 0 hides it", () => {
  const { rerender, props } = setup({ unreadCount: 5 });
  expect(screen.getByText("5")).toBeInTheDocument();
  rerender(
    <TopBar
      {...props}
      unreadCount={0}
    />,
  );
  expect(screen.queryByText("5")).not.toBeInTheDocument();
});

test("breadcrumb without route omits route segment", () => {
  setup({ breadcrumb: { section: "Mass-apply" } });
  expect(screen.getByRole("button", { name: /Mass-apply/ })).toBeInTheDocument();
  expect(screen.queryByText("Editor")).not.toBeInTheDocument();
});
