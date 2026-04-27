/**
 * notificationStore — client-side notification feed for HireScript Suite.
 *
 * Slice 2.5 wires the plumbing only. There is no backend persistence: the
 * store lives in module memory and is seeded by frontend events such as job
 * state transitions or sync failures. Each push notification (Pushover, ntfy)
 * is a Slice 3 concern — this module exposes shape and lifecycle hooks so
 * those flows can land cleanly later.
 *
 * The store is a tiny pub/sub: callers subscribe to a single change signal
 * and re-read snapshots through `getAll()` / `getUnreadCount()`. This keeps
 * the API trivial to consume from a React hook (`useNotifications`) without
 * pulling in a state library.
 */
import type { View } from "../../App";

export type NotificationKind = "job-state" | "sync-failure" | "info";

export interface NotificationDeepLink {
  view: View;
}

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** Epoch ms when the notification was added. */
  createdAt: number;
  /**
   * Epoch ms when the user marked the notification read, or `null` when
   * still unread. Dismissed notifications are removed entirely; "read"
   * tracks acknowledgement without dropping the row from the Earlier list.
   */
  readAt?: number | null;
  deepLink?: NotificationDeepLink;
}

export type NotificationInput = Omit<Notification, "id" | "createdAt" | "readAt">;

type Listener = () => void;

let items: Notification[] = [];
const listeners = new Set<Listener>();
let counter = 0;

function notify(): void {
  for (const cb of Array.from(listeners)) {
    try {
      cb();
    } catch {
      // listeners must not throw across each other
    }
  }
}

function nextId(): string {
  counter += 1;
  return `n-${Date.now().toString(36)}-${counter}`;
}

export const notificationStore = {
  getAll(): Notification[] {
    // Return a fresh array so consumers can compare references for change.
    return items.slice();
  },

  getUnreadCount(): number {
    let n = 0;
    for (const it of items) if (it.readAt == null) n += 1;
    return n;
  },

  add(input: NotificationInput): Notification {
    const n: Notification = {
      id: nextId(),
      createdAt: Date.now(),
      readAt: null,
      ...input,
    };
    items = [n, ...items];
    notify();
    return n;
  },

  dismiss(id: string): void {
    const next = items.filter((n) => n.id !== id);
    if (next.length === items.length) return;
    items = next;
    notify();
  },

  markAllRead(): void {
    let changed = false;
    const now = Date.now();
    items = items.map((n) => {
      if (n.readAt == null) {
        changed = true;
        return { ...n, readAt: now };
      }
      return n;
    });
    if (changed) notify();
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },

  /** Test-only reset. Not exported via index — call directly in tests. */
  _resetForTests(): void {
    items = [];
    counter = 0;
    listeners.clear();
  },
};

export type NotificationStore = typeof notificationStore;
