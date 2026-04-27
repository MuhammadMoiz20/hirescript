import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import NavRail, { type NavKey, type NavRailProps } from "./NavRail";

function setup(overrides: Partial<NavRailProps> = {}) {
  const props: NavRailProps = {
    active: "library",
    onNavigate: vi.fn(),
    editorOpen: false,
    ...overrides,
  };
  const utils = render(<NavRail {...props} />);
  return { ...utils, props };
}

test("renders both group eyebrows and Settings bottom item", () => {
  setup();
  expect(screen.getByText(/per-job/i)).toBeInTheDocument();
  expect(screen.getByText(/mass-apply/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
});

test("per-job group lists Library, Tailor, JDs, History when editor is closed", () => {
  setup({ editorOpen: false });
  expect(screen.getByRole("link", { name: /library/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /tailor/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /job posts/i })).toBeInTheDocument();
  // Two History entries exist when editorOpen=true; with closed editor, still one per-job + mass-apply.
  expect(screen.getAllByRole("link", { name: /history/i })).toHaveLength(2);
});

test("editorOpen=false hides Editor and Diff; editorOpen=true reveals them", () => {
  const { rerender, props } = setup({ editorOpen: false });
  expect(screen.queryByRole("link", { name: /^editor$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /diff/i })).not.toBeInTheDocument();
  rerender(<NavRail {...props} editorOpen={true} />);
  expect(screen.getByRole("link", { name: /^editor$/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /diff/i })).toBeInTheDocument();
});

test("active item gets aria-current='page'", () => {
  setup({ active: "inbox" });
  const inbox = screen.getByRole("link", { name: /inbox/i });
  expect(inbox).toHaveAttribute("aria-current", "page");
  const library = screen.getByRole("link", { name: /library/i });
  expect(library).not.toHaveAttribute("aria-current");
});

test("clicking a nav item fires onNavigate with the key", () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole("link", { name: /tailor/i }));
  expect(props.onNavigate).toHaveBeenCalledWith("tailor" satisfies NavKey);
});

test("clicking Settings fires onNavigate('settings')", () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole("link", { name: /settings/i }));
  expect(props.onNavigate).toHaveBeenCalledWith("settings");
});

test("badge with count > 0 renders chip", () => {
  setup({ badges: { inbox: 4, queue: 2 } });
  const inbox = screen.getByRole("link", { name: /inbox/i });
  expect(within(inbox).getByText("4")).toBeInTheDocument();
  const queue = screen.getByRole("link", { name: /queue/i });
  expect(within(queue).getByText("2")).toBeInTheDocument();
});

test("badge with count of 0 omits the chip", () => {
  setup({ badges: { inbox: 0 } });
  const inbox = screen.getByRole("link", { name: /inbox/i });
  expect(within(inbox).queryByText("0")).not.toBeInTheDocument();
});

test("collapsed=true hides text labels but glyphs retain accessible names", () => {
  setup({ collapsed: true });
  // Eyebrow group labels are hidden in collapsed mode.
  expect(screen.queryByText(/^per-job$/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/^mass-apply$/i)).not.toBeInTheDocument();
  // Items still expose accessible names via aria-label.
  expect(screen.getByRole("link", { name: /library/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
});

test("toggle collapse button fires onToggleCollapsed", () => {
  const onToggle = vi.fn();
  setup({ onToggleCollapsed: onToggle });
  fireEvent.click(screen.getByRole("button", { name: /collapse nav|expand nav/i }));
  expect(onToggle).toHaveBeenCalledTimes(1);
});

test("collapse toggle is hidden when onToggleCollapsed is not provided", () => {
  setup();
  expect(screen.queryByRole("button", { name: /collapse nav|expand nav/i })).not.toBeInTheDocument();
});

test("active=null leaves no item with aria-current", () => {
  setup({ active: null });
  screen.getAllByRole("link").forEach((el) => {
    expect(el).not.toHaveAttribute("aria-current");
  });
});
