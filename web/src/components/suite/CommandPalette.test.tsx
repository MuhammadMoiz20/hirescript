import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import CommandPalette, { type CommandItem, type CommandPaletteProps } from "./CommandPalette";

function makeItems(overrides: Partial<Record<string, () => void>> = {}): CommandItem[] {
  return [
    {
      id: "nav-editor",
      label: "Editor",
      group: "Navigation",
      keywords: ["latex", "code"],
      hint: "Editor",
      onRun: overrides["nav-editor"] ?? vi.fn(),
    },
    {
      id: "nav-settings",
      label: "Settings",
      group: "Navigation",
      hint: "Settings",
      onRun: overrides["nav-settings"] ?? vi.fn(),
    },
    {
      id: "recent-acme",
      label: "Acme — Senior FE",
      group: "Recent",
      keywords: ["resume"],
      onRun: overrides["recent-acme"] ?? vi.fn(),
    },
    {
      id: "action-theme",
      label: "Toggle theme",
      group: "Actions",
      hint: "⌘D",
      onRun: overrides["action-theme"] ?? vi.fn(),
    },
  ];
}

function setup(overrides: Partial<CommandPaletteProps> = {}) {
  const props: CommandPaletteProps = {
    open: true,
    onClose: vi.fn(),
    items: makeItems(),
    ...overrides,
  };
  const utils = render(<CommandPalette {...props} />);
  return { ...utils, props };
}

test("renders nothing when open=false", () => {
  setup({ open: false });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("when open=true, renders dialog with input, group headers and items", () => {
  setup();
  const dialog = screen.getByRole("dialog", { name: /command palette/i });
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByRole("textbox", { name: /search commands/i })).toBeInTheDocument();
  expect(within(dialog).getByText("Navigation")).toBeInTheDocument();
  expect(within(dialog).getByText("Recent")).toBeInTheDocument();
  expect(within(dialog).getByText("Actions")).toBeInTheDocument();
  expect(within(dialog).getByRole("option", { name: /Editor/ })).toBeInTheDocument();
  expect(within(dialog).getByRole("option", { name: /Settings/ })).toBeInTheDocument();
  expect(within(dialog).getByRole("option", { name: /Acme/ })).toBeInTheDocument();
  expect(within(dialog).getByRole("option", { name: /Toggle theme/ })).toBeInTheDocument();
});

test("input is auto-focused on open", () => {
  setup();
  expect(screen.getByRole("textbox", { name: /search commands/i })).toHaveFocus();
});

test("dialog has a11y attributes", () => {
  setup();
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAttribute("aria-label", "Command palette");
});

test("typing filters items by label substring", () => {
  setup();
  const input = screen.getByRole("textbox", { name: /search commands/i });
  fireEvent.change(input, { target: { value: "ed" } });
  expect(screen.getByRole("option", { name: /Editor/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Settings/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Toggle theme/ })).not.toBeInTheDocument();
});

test("typing matches against keywords as well as label", () => {
  setup();
  const input = screen.getByRole("textbox", { name: /search commands/i });
  fireEvent.change(input, { target: { value: "latex" } });
  expect(screen.getByRole("option", { name: /Editor/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Settings/ })).not.toBeInTheDocument();
});

test("group header hides when its group has no remaining items after filter", () => {
  setup();
  const input = screen.getByRole("textbox", { name: /search commands/i });
  fireEvent.change(input, { target: { value: "theme" } });
  expect(screen.getByText("Actions")).toBeInTheDocument();
  expect(screen.queryByText("Navigation")).not.toBeInTheDocument();
  expect(screen.queryByText("Recent")).not.toBeInTheDocument();
});

test("Esc key calls onClose", () => {
  const { props } = setup();
  fireEvent.keyDown(screen.getByRole("dialog").parentElement!, { key: "Escape" });
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

test("Enter runs the highlighted (first) item then calls onClose", () => {
  const editorRun = vi.fn();
  const onClose = vi.fn();
  const items = makeItems({ "nav-editor": editorRun });
  render(<CommandPalette open onClose={onClose} items={items} />);
  fireEvent.keyDown(screen.getByRole("dialog").parentElement!, { key: "Enter" });
  expect(editorRun).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("ArrowDown then Enter runs the second item", () => {
  const settingsRun = vi.fn();
  const editorRun = vi.fn();
  const onClose = vi.fn();
  const items = makeItems({ "nav-editor": editorRun, "nav-settings": settingsRun });
  render(<CommandPalette open onClose={onClose} items={items} />);
  const backdrop = screen.getByRole("dialog").parentElement!;
  fireEvent.keyDown(backdrop, { key: "ArrowDown" });
  fireEvent.keyDown(backdrop, { key: "Enter" });
  expect(settingsRun).toHaveBeenCalledTimes(1);
  expect(editorRun).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("ArrowUp from first wraps to last item", () => {
  const themeRun = vi.fn();
  const onClose = vi.fn();
  const items = makeItems({ "action-theme": themeRun });
  render(<CommandPalette open onClose={onClose} items={items} />);
  const backdrop = screen.getByRole("dialog").parentElement!;
  fireEvent.keyDown(backdrop, { key: "ArrowUp" });
  fireEvent.keyDown(backdrop, { key: "Enter" });
  expect(themeRun).toHaveBeenCalledTimes(1);
});

test("clicking an item runs it and calls onClose", () => {
  const themeRun = vi.fn();
  const onClose = vi.fn();
  const items = makeItems({ "action-theme": themeRun });
  render(<CommandPalette open onClose={onClose} items={items} />);
  fireEvent.click(screen.getByRole("option", { name: /Toggle theme/ }));
  expect(themeRun).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("clicking the backdrop calls onClose; clicking the dialog does not", () => {
  const { props } = setup();
  // dialog click should not close
  fireEvent.click(screen.getByRole("dialog"));
  expect(props.onClose).not.toHaveBeenCalled();
  // backdrop is the dialog's parent
  const backdrop = screen.getByRole("dialog").parentElement!;
  fireEvent.click(backdrop);
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

test("typing then ArrowDown+Enter runs the second of the filtered items", () => {
  const acmeRun = vi.fn();
  const editorRun = vi.fn();
  const onClose = vi.fn();
  // Add a second Recent item so typing 'r' matches multiple recents/keywords.
  const items: CommandItem[] = [
    { id: "nav-editor", label: "Editor", group: "Navigation", keywords: ["resume"], onRun: editorRun },
    { id: "recent-acme", label: "Acme — Senior FE", group: "Recent", keywords: ["resume"], onRun: acmeRun },
  ];
  render(<CommandPalette open onClose={onClose} items={items} />);
  const input = screen.getByRole("textbox", { name: /search commands/i });
  fireEvent.change(input, { target: { value: "resume" } });
  const backdrop = screen.getByRole("dialog").parentElement!;
  fireEvent.keyDown(backdrop, { key: "ArrowDown" });
  fireEvent.keyDown(backdrop, { key: "Enter" });
  expect(acmeRun).toHaveBeenCalledTimes(1);
  expect(editorRun).not.toHaveBeenCalled();
});

test("renders empty state when filter matches nothing", () => {
  setup();
  const input = screen.getByRole("textbox", { name: /search commands/i });
  fireEvent.change(input, { target: { value: "zzznotathing" } });
  expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
});

test("hint text is rendered next to the row", () => {
  setup();
  expect(screen.getByText("⌘D")).toBeInTheDocument();
});
