/**
 * TopBar — HireScript Suite shell header.
 *
 * Pure presentational component. Layout (per bundle `suite.jsx` + `ma-shell.jsx`):
 *
 *   [ H | HireScript ]   [ section › route ]   [ MaxGauge | ⌘K | ☀/☾ | 🔔(n) ]
 *
 * No routing, no global state — props in, callbacks out. The parent (suite
 * shell) wires breadcrumb labels, theme, notification count, and command
 * palette open/close.
 *
 * Also installs a window-level `Cmd/Ctrl+K` listener that calls
 * `onOpenCommandPalette` and prevents default. Cleaned up on unmount.
 */

import { useEffect } from "react";
import MaxGauge from "../ui/MaxGauge";

export interface TopBarProps {
  breadcrumb: { section: string; route?: string };
  onBreadcrumbClick?: (level: "section" | "root") => void;
  maxGaugeProps: { usedPct: number; resetsAt: Date };
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenCommandPalette: () => void;
  unreadCount: number;
  onOpenNotifications: () => void;
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  // navigator.userAgentData?.platform is the modern surface; fall back to navigator.platform.
  const uad = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  const plat = (uad?.platform || navigator.platform || "").toLowerCase();
  return plat.includes("mac");
}

const ICON_BTN: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--rule)",
  color: "var(--ink-2)",
  fontFamily: "var(--f-mono)",
  fontSize: 12,
  padding: "4px 8px",
  cursor: "pointer",
  borderRadius: 2,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  lineHeight: 1,
};

function BellIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.5 11.5h9l-1-1.5V7a3.5 3.5 0 0 0-7 0v3l-1 1.5Z" />
      <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

export default function TopBar({
  breadcrumb,
  onBreadcrumbClick,
  maxGaugeProps,
  theme,
  onToggleTheme,
  onOpenCommandPalette,
  unreadCount,
  onOpenNotifications,
}: TopBarProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenCommandPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenCommandPalette]);

  const cmdGlyph = isMacPlatform() ? "⌘K" : "Ctrl+K";
  const themeNext = theme === "light" ? "dark" : "light";
  const themeGlyph = theme === "light" ? "☾" : "☀";

  return (
    <header
      data-component="suite-topbar"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        height: 56,
        background: "var(--paper)",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 16,
      }}
    >
      {/* Left: wordmark */}
      <button
        type="button"
        onClick={() => onBreadcrumbClick?.("root")}
        aria-label="HireScript home"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "inherit",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 28,
            height: 28,
            background: "var(--ink)",
            color: "var(--paper)",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--f-mono)",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          H
        </div>
        <span
          style={{
            fontFamily: "var(--f-serif)",
            fontSize: 17,
            color: "var(--ink)",
            lineHeight: 1,
          }}
        >
          HireScript
        </span>
      </button>

      {/* Center: breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--f-mono)",
          fontSize: 12,
          color: "var(--ink-3)",
          minWidth: 0,
        }}
      >
        <button
          type="button"
          onClick={() => onBreadcrumbClick?.("section")}
          style={{
            background: "transparent",
            border: "none",
            padding: "2px 4px",
            cursor: "pointer",
            color: "var(--ink-2)",
            fontFamily: "inherit",
            fontSize: "inherit",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {breadcrumb.section}
        </button>
        {breadcrumb.route && (
          <>
            <span aria-hidden style={{ color: "var(--ink-4)" }}>›</span>
            <span style={{ color: "var(--ink)" }}>{breadcrumb.route}</span>
          </>
        )}
      </nav>

      {/* Right: actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <MaxGauge {...maxGaugeProps} size="compact" />

        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Open command palette"
          title="Open command palette"
          style={{
            ...ICON_BTN,
            color: "var(--ink-3)",
          }}
        >
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>{cmdGlyph}</span>
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={`Switch to ${themeNext} theme`}
          title={`Switch to ${themeNext} theme`}
          style={ICON_BTN}
        >
          {themeGlyph}
        </button>

        <button
          type="button"
          onClick={onOpenNotifications}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          title="Notifications"
          style={{ ...ICON_BTN, position: "relative", padding: "4px 9px" }}
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span
              data-part="unread-chip"
              style={{
                position: "absolute",
                top: -5,
                right: -5,
                minWidth: 14,
                height: 14,
                padding: "0 3px",
                background: "var(--accent)",
                color: "white",
                fontFamily: "var(--f-mono)",
                fontSize: 9,
                fontWeight: 600,
                display: "grid",
                placeItems: "center",
                borderRadius: 14,
                lineHeight: 1,
              }}
            >
              {unreadCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
