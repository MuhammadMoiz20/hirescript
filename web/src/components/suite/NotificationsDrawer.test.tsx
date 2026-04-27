import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import NotificationsDrawer, { type NotificationsDrawerProps } from "./NotificationsDrawer";
import type { Notification } from "./notificationStore";

const NOW = Date.now();

function makeNotifications(): Notification[] {
  return [
    {
      id: "n1",
      kind: "job-state",
      title: "Apply queue paused",
      body: "Connector returned 429",
      createdAt: NOW - 60_000,
      readAt: null,
      deepLink: { view: "applications" },
    },
    {
      id: "n2",
      kind: "sync-failure",
      title: "Greenhouse sync failed",
      body: "Auth expired",
      createdAt: NOW - 5 * 60_000,
      readAt: null,
    },
    {
      id: "n3",
      kind: "info",
      title: "Daily summary ready",
      body: "12 applied, 3 stuck",
      createdAt: NOW - 60 * 60_000,
      readAt: NOW - 30 * 60_000,
    },
  ];
}

function setup(overrides: Partial<NotificationsDrawerProps> = {}) {
  const props: NotificationsDrawerProps = {
    open: true,
    onClose: vi.fn(),
    notifications: makeNotifications(),
    onDismiss: vi.fn(),
    onDeepLink: vi.fn(),
    onMarkAllRead: vi.fn(),
    ...overrides,
  };
  const utils = render(<NotificationsDrawer {...props} />);
  return { ...utils, props };
}

test("renders nothing when open=false", () => {
  const { container } = setup({ open: false });
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("renders the drawer with header and push channels when open", () => {
  setup();
  expect(screen.getByRole("dialog", { name: /notifications/i })).toBeInTheDocument();
  expect(screen.getByText("Notifications")).toBeInTheDocument();
  // Push channels subsection
  const push = screen.getByText("Push channels").closest("[data-part='push-channels']");
  expect(push).not.toBeNull();
  expect(within(push as HTMLElement).getByText("Pushover")).toBeInTheDocument();
  expect(within(push as HTMLElement).getByText("ntfy")).toBeInTheDocument();
  expect(within(push as HTMLElement).getByText(/coming in slice 3/i)).toBeInTheDocument();
});

test("splits notifications into New and Earlier sections", () => {
  setup();
  const newSection = document.querySelector("[data-part='section-new']");
  const earlierSection = document.querySelector("[data-part='section-earlier']");
  expect(newSection).not.toBeNull();
  expect(earlierSection).not.toBeNull();
  expect(within(newSection as HTMLElement).getByText("Apply queue paused")).toBeInTheDocument();
  expect(within(newSection as HTMLElement).getByText("Greenhouse sync failed")).toBeInTheDocument();
  expect(within(earlierSection as HTMLElement).getByText("Daily summary ready")).toBeInTheDocument();
});

test("renders empty state when there are no notifications", () => {
  setup({ notifications: [] });
  expect(screen.getByText(/no notifications/i)).toBeInTheDocument();
  expect(document.querySelector("[data-part='section-new']")).toBeNull();
  expect(document.querySelector("[data-part='section-earlier']")).toBeNull();
});

test("dismiss button fires onDismiss with the notification id", () => {
  const onDismiss = vi.fn();
  setup({ onDismiss });
  const row = screen.getByText("Apply queue paused").closest("[data-part='notification-row']");
  expect(row).not.toBeNull();
  const btn = within(row as HTMLElement).getByRole("button", { name: /dismiss apply queue paused/i });
  fireEvent.click(btn);
  expect(onDismiss).toHaveBeenCalledWith("n1");
});

test("deep-link button fires onDeepLink with the link target", () => {
  const onDeepLink = vi.fn();
  setup({ onDeepLink });
  const row = screen.getByText("Apply queue paused").closest("[data-part='notification-row']");
  const btn = within(row as HTMLElement).getByRole("button", { name: /^open$/i });
  fireEvent.click(btn);
  expect(onDeepLink).toHaveBeenCalledWith({ view: "applications" });
});

test("notifications without deepLink omit the Open button", () => {
  setup();
  const row = screen.getByText("Greenhouse sync failed").closest("[data-part='notification-row']");
  expect(within(row as HTMLElement).queryByRole("button", { name: /^open$/i })).toBeNull();
});

test("close button fires onClose", () => {
  const onClose = vi.fn();
  setup({ onClose });
  fireEvent.click(screen.getByRole("button", { name: /close notifications/i }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("scrim click fires onClose", () => {
  const onClose = vi.fn();
  setup({ onClose });
  const scrim = document.querySelector("[data-part='notifications-scrim']");
  expect(scrim).not.toBeNull();
  fireEvent.click(scrim as HTMLElement);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("mark all read button fires onMarkAllRead when provided", () => {
  const onMarkAllRead = vi.fn();
  setup({ onMarkAllRead });
  fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));
  expect(onMarkAllRead).toHaveBeenCalledTimes(1);
});

test("push channel toggles render disabled (Slice 3 placeholder)", () => {
  setup();
  const push = screen.getByText("Push channels").closest("[data-part='push-channels']") as HTMLElement;
  const toggles = within(push).getAllByRole("button");
  expect(toggles).toHaveLength(2);
  for (const t of toggles) {
    expect(t).toBeDisabled();
    expect(t).toHaveAttribute("aria-disabled", "true");
  }
});
