/**
 * NavRail — HireScript Suite left navigation.
 *
 * Pure presentational component. Two grouped sections (Per-job, Mass-apply)
 * with eyebrow labels and a Settings item anchored at the bottom. Per the
 * walking-skeleton scope rules in CLAUDE.md, this component owns no routing
 * or state — props in, callbacks out. Parent (suite shell, T11) maps the
 * `NavKey` to its router and supplies live `badges` (e.g. inbox unread).
 *
 * Visual treatment follows bundle `ma-shell.jsx` + `suite.jsx`:
 *  - active row: paper-2 background with a 2px ink left border, ink text
 *  - badges: small mono chip beside the label (colour-coded for queue-needs-you)
 *  - collapsed mode: 56px wide, glyph-only; labels exposed via aria-label
 *
 * `Editor` and `Diff` only appear in the per-job group when `editorOpen` is
 * true — they are context-dependent surfaces tied to an open resume.
 */

import type { CSSProperties } from "react";

export type NavKey =
  | "library"
  | "editor"
  | "diff"
  | "tailor"
  | "jds"
  | "history-perjob"
  | "dashboard"
  | "inbox"
  | "queue"
  | "history-massapply"
  | "knowledge"
  | "tiers"
  | "settings";

export interface NavRailProps {
  active: NavKey | null;
  onNavigate: (key: NavKey) => void;
  /** When true, Editor + Diff appear in the per-job group. */
  editorOpen: boolean;
  /** Optional badge counts. Counts <= 0 are not rendered. */
  badges?: Partial<Record<NavKey, number>>;
  /** When true, hides labels and group eyebrows; keeps glyphs + aria-labels. */
  collapsed?: boolean;
  /** Optional collapse handle. When omitted, the toggle button is hidden. */
  onToggleCollapsed?: () => void;
}

interface NavItem {
  key: NavKey;
  label: string;
  glyph: string;
  /** Accent for badge background — 'accent' for needs-you, default neutral. */
  badgeTone?: "accent" | "neutral";
}

const PER_JOB_BASE: NavItem[] = [
  { key: "library", label: "Library", glyph: "▤" },
];
const PER_JOB_EDITOR: NavItem[] = [
  { key: "editor", label: "Editor", glyph: "≡" },
  { key: "diff", label: "Diff", glyph: "⇄" },
];
const PER_JOB_TAIL: NavItem[] = [
  { key: "tailor", label: "Tailor", glyph: "→" },
  { key: "jds", label: "Job posts", glyph: "▢" },
  { key: "history-perjob", label: "History", glyph: "◷" },
];

const MASS_APPLY_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", glyph: "◐" },
  { key: "inbox", label: "Inbox", glyph: "✉", badgeTone: "accent" },
  { key: "queue", label: "Queue", glyph: "⏵", badgeTone: "accent" },
  { key: "history-massapply", label: "History", glyph: "◷" },
  { key: "knowledge", label: "Knowledge", glyph: "◇" },
  { key: "tiers", label: "Tiers", glyph: "▦" },
];

const SETTINGS_ITEM: NavItem = { key: "settings", label: "Settings", glyph: "✦" };

const EYEBROW: CSSProperties = {
  fontFamily: "var(--f-mono)",
  fontSize: 10,
  color: "var(--ink-4)",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "12px 14px 6px",
};

interface RowProps {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  count?: number;
  onClick: () => void;
}

function NavRow({ item, active, collapsed, count, onClick }: RowProps) {
  const showBadge = typeof count === "number" && count > 0;
  const badgeBg = item.badgeTone === "accent" ? "var(--accent)" : "var(--paper-3)";
  const badgeFg = item.badgeTone === "accent" ? "white" : "var(--ink-3)";

  return (
    <a
      href={`#/${item.key}`}
      role="link"
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      data-nav-key={item.key}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: collapsed ? "9px 10px" : "8px 10px",
        margin: "0 6px",
        fontFamily: "var(--f-sans)",
        fontSize: 13,
        color: active ? "var(--ink)" : "var(--ink-2)",
        background: active ? "var(--paper-2)" : "transparent",
        borderLeft: active ? "2px solid var(--ink)" : "2px solid transparent",
        fontWeight: active ? 600 : 400,
        textDecoration: "none",
        whiteSpace: "nowrap",
        justifyContent: collapsed ? "center" : "flex-start",
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 16,
          textAlign: "center",
          color: active ? "var(--ink)" : "var(--ink-3)",
          fontFamily: "var(--f-mono)",
          fontSize: 13,
        }}
      >
        {item.glyph}
      </span>
      {!collapsed && (
        <>
          <span style={{ flex: 1 }}>{item.label}</span>
          {showBadge && (
            <span
              data-part="nav-badge"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10,
                color: badgeFg,
                padding: "1px 5px",
                background: badgeBg,
                borderRadius: 2,
                lineHeight: 1.4,
                minWidth: 14,
                textAlign: "center",
              }}
            >
              {count}
            </span>
          )}
        </>
      )}
    </a>
  );
}

export default function NavRail({
  active,
  onNavigate,
  editorOpen,
  badges,
  collapsed = false,
  onToggleCollapsed,
}: NavRailProps) {
  const perJobItems: NavItem[] = [
    ...PER_JOB_BASE,
    ...(editorOpen ? PER_JOB_EDITOR : []),
    ...PER_JOB_TAIL,
  ];

  const renderRow = (item: NavItem) => (
    <NavRow
      key={item.key}
      item={item}
      active={active === item.key}
      collapsed={collapsed}
      count={badges?.[item.key]}
      onClick={() => onNavigate(item.key)}
    />
  );

  return (
    <aside
      data-component="suite-navrail"
      aria-label="Primary navigation"
      style={{
        width: collapsed ? 56 : 208,
        flexShrink: 0,
        background: "var(--paper)",
        borderRight: "1px solid var(--rule)",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.18s ease",
        position: "sticky",
        top: 56,
        height: "calc(100vh - 56px)",
        overflow: "hidden",
      }}
    >
      {onToggleCollapsed && (
        <div
          style={{
            padding: "10px 10px 4px",
            display: "flex",
            justifyContent: collapsed ? "center" : "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand nav" : "Collapse nav"}
            title={collapsed ? "Expand nav" : "Collapse nav"}
            style={{
              background: "transparent",
              border: "1px solid var(--rule)",
              color: "var(--ink-3)",
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              padding: "2px 6px",
              cursor: "pointer",
              borderRadius: 2,
              lineHeight: 1,
            }}
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>
      )}

      <nav
        aria-label="Per-job"
        style={{ display: "flex", flexDirection: "column", gap: 1 }}
      >
        {!collapsed && <div style={EYEBROW}>Per-job</div>}
        {perJobItems.map(renderRow)}
      </nav>

      <nav
        aria-label="Mass-apply"
        style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 8 }}
      >
        {!collapsed && <div style={EYEBROW}>Mass-apply</div>}
        {MASS_APPLY_ITEMS.map(renderRow)}
      </nav>

      <div style={{ flex: 1 }} />

      <div
        style={{
          borderTop: "1px solid var(--rule)",
          padding: "6px 0 10px",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {renderRow(SETTINGS_ITEM)}
      </div>
    </aside>
  );
}
