/**
 * useNotifications — React binding for the client-side notification store.
 *
 * Returns a stable snapshot plus the unread count so components like the
 * TopBar bell and the NotificationsDrawer can render without coordinating
 * subscriptions themselves. Re-renders only fire when the store emits.
 *
 * `useSyncExternalStore` requires a *stable* snapshot identity between calls
 * when the underlying state hasn't changed; otherwise React loops. The store
 * itself returns a new array on every `getAll()`, so we cache the latest
 * array reference here and only refresh it when a notify event fires.
 */
import { useSyncExternalStore } from "react";
import { notificationStore, type Notification } from "./notificationStore";

export interface NotificationsView {
  notifications: Notification[];
  unreadCount: number;
}

let cached: Notification[] = notificationStore.getAll();

function refresh(): void {
  cached = notificationStore.getAll();
}

function subscribe(cb: () => void): () => void {
  return notificationStore.subscribe(() => {
    refresh();
    cb();
  });
}

function getSnapshot(): Notification[] {
  return cached;
}

export function useNotifications(): NotificationsView {
  const notifications = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  let unreadCount = 0;
  for (const n of notifications) if (n.readAt == null) unreadCount += 1;
  return { notifications, unreadCount };
}
