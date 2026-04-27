/**
 * PostingCard — Inbox row component.
 *
 * Refactored from a card to a table-like row matching the design bundle's
 * `JobRow` (ma-screens-1.jsx). Columns: company/role, tier, fit, status,
 * source, ingested, inline actions. Uses the mass-apply primitives
 * (TierBadge, FitChip, StatusPill, ModeToggle).
 *
 * Public API kept minimal and consistent with the previous card: callers
 * pass a Posting plus open/prepare/skip handlers and a `preparing` flag.
 * Inbox is the only consumer (verified with grep).
 */

import { Posting } from "../api";
import Button from "./ui/Button";
import TierBadge, { Tier } from "./ui/TierBadge";
import FitChip from "./ui/FitChip";
import StatusPill, { StatusKind } from "./ui/StatusPill";
import ModeToggle from "./ui/ModeToggle";

interface Props {
  posting: Posting;
  selected?: boolean;
  onClick: (id: number) => void;
  onPrepare: (id: number) => void;
  onSkip?: (id: number) => void;
  preparing?: boolean;
}

// Backend tier strings → TierBadge kinds. Backend uses `wide_net`; primitive
// uses `wide`. Anything else (null, unknown) renders no badge.
function mapTier(value: string | null): Tier | null {
  switch (value) {
    case "dream": return "dream";
    case "targeted": return "targeted";
    case "wide_net": return "wide";
    case "skip": return "skip";
    default: return null;
  }
}

// Backend posting.status strings → StatusPill kinds. The pill primitive only
// covers a fixed set; statuses outside it render as a plain mono label so we
// don't fake a pill state. Mapping intentionally narrow — extend when the
// backend grows new states.
function mapStatus(value: string): StatusKind | null {
  switch (value) {
    case "preparing": return "running";
    case "prepared": return "prepared";
    case "ready": return "prepared";
    case "submitted": return "submitted";
    case "skipped": return "cancelled";
    case "duplicate_skipped": return "duplicate_skipped";
    case "failed": return "failed";
    case "errored": return "errored";
    case "stuck": return "stuck";
    case "paused": return "paused";
    case "queued": return "queued";
    default: return null; // ingested, classified, anything novel
  }
}

function fmtAgo(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

// Grid template aligned with the column header in Inbox.tsx. Keep these in
// sync — both files declare the same columns.
export const POSTING_ROW_COLUMNS =
  "minmax(220px, 1.6fr) 110px 80px 130px 110px 70px minmax(180px, auto)";

export default function PostingCard({
  posting,
  selected,
  onClick,
  onPrepare,
  onSkip,
  preparing,
}: Props) {
  const tier = mapTier(posting.tier);
  const statusKind = mapStatus(posting.status);
  const isPreparing = preparing || posting.status === "preparing";
  const isPrepared = posting.status === "prepared" || posting.status === "ready";

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="posting-row"
      data-posting-id={posting.id}
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      onClick={() => onClick(posting.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(posting.id);
        }
      }}
      style={{
        display: "grid",
        gridTemplateColumns: POSTING_ROW_COLUMNS,
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        borderBottom: "1px solid var(--rule)",
        background: selected ? "var(--paper-2)" : "var(--paper)",
        cursor: "pointer",
        minHeight: 52,
        outline: "none",
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--paper-2)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--paper)";
      }}
    >
      {/* Company / Role — primary key/value */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{
          fontWeight: 500,
          fontSize: 13,
          color: "var(--ink)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {posting.company || "Unknown company"}
        </div>
        <div style={{
          fontSize: 11.5,
          color: "var(--ink-3)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontFamily: "var(--f-mono)",
        }}>
          {posting.title}
          {posting.location ? ` · ${posting.location}` : ""}
        </div>
      </div>

      {/* Tier */}
      <div>
        {tier ? (
          <TierBadge tier={tier} />
        ) : (
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>—</span>
        )}
      </div>

      {/* Fit */}
      <div>
        <FitChip score={posting.fit_score} />
      </div>

      {/* Status */}
      <div>
        {statusKind ? (
          <StatusPill status={statusKind} />
        ) : (
          <span
            className="mono"
            data-testid="posting-status-fallback"
            style={{
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 999,
              border: "1px solid var(--rule)",
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
            }}
          >
            {posting.status}
          </span>
        )}
      </div>

      {/* Source + mode (read-only B-mode placeholder until backend exposes mode) */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            textTransform: "lowercase",
          }}
        >
          {posting.source}
        </span>
        <ModeToggle mode="B" disabled />
      </div>

      {/* Ingested */}
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--ink-3)",
          fontVariantNumeric: "tabular-nums",
        }}
        title={posting.ingested_at}
      >
        {fmtAgo(posting.ingested_at)}
      </div>

      {/* Inline actions */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}
      >
        {onSkip && posting.status !== "skipped" && posting.status !== "skip" && (
          <Button size="sm" variant="ghost" onClick={() => onSkip(posting.id)}>
            Skip
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          data-testid="posting-prepare-btn"
          disabled={isPreparing || isPrepared}
          onClick={() => onPrepare(posting.id)}
        >
          {isPreparing ? "Preparing…" : isPrepared ? "Prepared" : "Prepare"}
        </Button>
      </div>
    </div>
  );
}
