import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { notificationStore } from "./notificationStore";

beforeEach(() => {
  notificationStore._resetForTests();
});

afterEach(() => {
  notificationStore._resetForTests();
});

describe("notificationStore", () => {
  test("add() inserts unread notification with id + createdAt", () => {
    const before = Date.now();
    const n = notificationStore.add({
      kind: "info",
      title: "Hello",
      body: "World",
    });
    expect(n.id).toMatch(/^n-/);
    expect(n.readAt).toBeNull();
    expect(n.createdAt).toBeGreaterThanOrEqual(before);
    expect(notificationStore.getAll()).toHaveLength(1);
  });

  test("getAll() returns most-recent first", () => {
    notificationStore.add({ kind: "info", title: "First" });
    notificationStore.add({ kind: "info", title: "Second" });
    const all = notificationStore.getAll();
    expect(all.map((n) => n.title)).toEqual(["Second", "First"]);
  });

  test("getUnreadCount() counts only unread items", () => {
    notificationStore.add({ kind: "info", title: "A" });
    notificationStore.add({ kind: "info", title: "B" });
    expect(notificationStore.getUnreadCount()).toBe(2);
    notificationStore.markAllRead();
    expect(notificationStore.getUnreadCount()).toBe(0);
  });

  test("dismiss() removes the matching notification", () => {
    const a = notificationStore.add({ kind: "info", title: "A" });
    notificationStore.add({ kind: "info", title: "B" });
    notificationStore.dismiss(a.id);
    const remaining = notificationStore.getAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe("B");
  });

  test("dismiss() with unknown id is a no-op and does not notify", () => {
    notificationStore.add({ kind: "info", title: "A" });
    const cb = vi.fn();
    const unsub = notificationStore.subscribe(cb);
    notificationStore.dismiss("nope");
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  test("markAllRead() sets readAt on every unread item", () => {
    notificationStore.add({ kind: "info", title: "A" });
    notificationStore.add({ kind: "info", title: "B" });
    notificationStore.markAllRead();
    const items = notificationStore.getAll();
    for (const n of items) expect(n.readAt).not.toBeNull();
    expect(notificationStore.getUnreadCount()).toBe(0);
  });

  test("subscribe() fires on add/dismiss/markAllRead and unsub stops it", () => {
    const cb = vi.fn();
    const unsub = notificationStore.subscribe(cb);
    const n = notificationStore.add({ kind: "info", title: "A" });
    expect(cb).toHaveBeenCalledTimes(1);
    notificationStore.markAllRead();
    expect(cb).toHaveBeenCalledTimes(2);
    notificationStore.dismiss(n.id);
    expect(cb).toHaveBeenCalledTimes(3);
    unsub();
    notificationStore.add({ kind: "info", title: "B" });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  test("markAllRead() does not notify when nothing changes", () => {
    const cb = vi.fn();
    const unsub = notificationStore.subscribe(cb);
    notificationStore.markAllRead();
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });
});
