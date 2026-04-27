/**
 * NotificationsDrawer — slide-in right rail triggered by the TopBar bell.
 *
 * Pure presentational: takes the notification snapshot from the parent and
 * fires `onDismiss` / `onDeepLink` callbacks. Sections split into "New"
 * (unread) and "Earlier" (read), each sorted desc by createdAt. The bottom
 * "Push channels" subsection renders disabled Pushover/ntfy toggles as a
 * Slice 3 placeholder so users can see the surface that will light up.
 *
 * Visual treatment mirrors `ma-screens-3.jsx::NotifDrawer` from the bundle:
 * 420px right-anchored panel, dimmed scrim, mono section labels, paper-2
 * highlight on unread rows.
 */
import type { Notification, NotificationDeepLink, NotificationKind } from "./notificationStore";

export interface NotificationsDrawerProps {
  open: boolean;
  onClose: () => void;
  notifications: Notification[];
  onDismiss: (id: string) => void;
  onDeepLink: (link: NotificationDeepLink) => void;
  onMarkAllRead?: () => void;
}

interface KindMeta {
  glyph: string;
  color: string;
  label: string;
}

const KIND_META: Record<NotificationKind, KindMeta> = {
  "job-state": { glyph: "◉", color: "var(--accent)", label: "Job state" },
  "sync-failure": { glyph: "↯", color: "var(--warn, #b76e00)", label: "Sync failure" },
  info: { glyph: "·", color: "var(--ink-3)", label: "Info" },
};

function fmtAgo(then: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function sortDesc(a: Notification, b: Notification): number {
  return b.createdAt - a.createdAt;
}

const SECTION_LABEL_STYLE: React.CSSProperties = {
  padding: "10px 20px 4px",
  fontFamily: "var(--f-mono)",
  fontSize: 10,
  color: "var(--ink-4)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const ROW_BTN: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--rule)",
  color: "var(--ink-3)",
  fontFamily: "var(--f-mono)",
  fontSize: 10,
  padding: "2px 6px",
  cursor: "pointer",
  borderRadius: 2,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  lineHeight: 1.4,
};

function NotifRow({
  notification,
  onDismiss,
  onDeepLink,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
  onDeepLink: (link: NotificationDeepLink) => void;
}) {
  const meta = KIND_META[notification.kind] ?? KIND_META.info;
  const unread = notification.readAt == null;
  return (
    <div
      data-part="notification-row"
      data-unread={unread ? "true" : "false"}
      style={{
        padding: "12px 20px",
        borderBottom: "1px solid var(--rule)",
        display: "grid",
        gridTemplateColumns: "20px 1fr auto",
        gap: 10,
        background: unread ? "var(--paper-2)" : "transparent",
        alignItems: "start",
      }}
    >
      <span
        aria-hidden
        title={meta.label}
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 12,
          color: meta.color,
          marginTop: 1,
        }}
      >
        {meta.glyph}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink)",
            fontWeight: unread ? 600 : 400,
            lineHeight: 1.3,
          }}
        >
          {notification.title}
        </div>
        {notification.body && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-2)",
              marginTop: 2,
              lineHeight: 1.4,
            }}
          >
            {notification.body}
          </div>
        )}
        <div
          style={{
            marginTop: 6,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          {notification.deepLink && (
            <button
              type="button"
              onClick={() => onDeepLink(notification.deepLink!)}
              data-part="deep-link"
              style={ROW_BTN}
            >
              Open
            </button>
          )}
          <button
            type="button"
            onClick={() => onDismiss(notification.id)}
            data-part="dismiss"
            aria-label={`Dismiss ${notification.title}`}
            style={ROW_BTN}
          >
            Dismiss
          </button>
        </div>
      </div>
      <span
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 10,
          color: "var(--ink-4)",
          whiteSpace: "nowrap",
        }}
      >
        {fmtAgo(notification.createdAt)}
      </span>
    </div>
  );
}

function PushChannelToggle({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 0",
        fontSize: 12,
        color: "var(--ink-2)",
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Coming in Slice 3"
        style={{
          width: 32,
          height: 18,
          borderRadius: 18,
          padding: 2,
          background: "var(--paper-3, var(--paper-2))",
          border: "1px solid var(--rule)",
          display: "inline-flex",
          alignItems: "center",
          cursor: "not-allowed",
          opacity: 0.6,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 12,
            height: 12,
            borderRadius: 12,
            background: "var(--paper)",
            display: "block",
          }}
        />
      </button>
    </div>
  );
}

export default function NotificationsDrawer({
  open,
  onClose,
  notifications,
  onDismiss,
  onDeepLink,
  onMarkAllRead,
}: NotificationsDrawerProps) {
  if (!open) return null;
  const sorted = notifications.slice().sort(sortDesc);
  const fresh = sorted.filter((n) => n.readAt == null);
  const earlier = sorted.filter((n) => n.readAt != null);

  return (
    <>
      <div
        data-part="notifications-scrim"
        onClick={onClose}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.18)",
          zIndex: 100,
        }}
      />
      <aside
        data-component="notifications-drawer"
        role="dialog"
        aria-label="Notifications"
        aria-modal="false"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          maxWidth: "100vw",
          background: "var(--paper)",
          borderLeft: "1px solid var(--rule)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "18px 20px",
            borderBottom: "1px solid var(--rule)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              fontFamily: "var(--f-serif)",
              fontSize: 20,
              color: "var(--ink)",
              flex: 1,
            }}
          >
            Notifications
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            style={{
              background: "transparent",
              border: "1px solid var(--rule)",
              color: "var(--ink-2)",
              fontFamily: "var(--f-mono)",
              width: 26,
              height: 26,
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {onMarkAllRead && (
          <div
            style={{
              padding: "10px 20px",
              borderBottom: "1px solid var(--rule)",
              display: "flex",
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={onMarkAllRead}
              style={ROW_BTN}
            >
              Mark all read
            </button>
          </div>
        )}

        <div
          data-part="notifications-list"
          style={{ flex: 1, overflowY: "auto" }}
        >
          {sorted.length === 0 && (
            <div
              data-part="empty"
              style={{
                padding: "32px 20px",
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                color: "var(--ink-4)",
                textAlign: "center",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              No notifications
            </div>
          )}
          {fresh.length > 0 && (
            <section data-part="section-new">
              <div style={SECTION_LABEL_STYLE}>New</div>
              {fresh.map((n) => (
                <NotifRow
                  key={n.id}
                  notification={n}
                  onDismiss={onDismiss}
                  onDeepLink={onDeepLink}
                />
              ))}
            </section>
          )}
          {earlier.length > 0 && (
            <section data-part="section-earlier">
              <div style={SECTION_LABEL_STYLE}>Earlier</div>
              {earlier.map((n) => (
                <NotifRow
                  key={n.id}
                  notification={n}
                  onDismiss={onDismiss}
                  onDeepLink={onDeepLink}
                />
              ))}
            </section>
          )}
        </div>

        <div
          data-part="push-channels"
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--rule)",
            background: "var(--paper-2)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 4,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span>Push channels</span>
            <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--ink-4)" }}>
              Coming in Slice 3
            </span>
          </div>
          <PushChannelToggle label="Pushover" />
          <PushChannelToggle label="ntfy" />
        </div>
      </aside>
    </>
  );
}
