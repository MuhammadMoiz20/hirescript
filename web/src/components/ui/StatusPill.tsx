/**
 * StatusPill — mass-apply primitive.
 *
 * Outlined pill with a glyph + mono label. Eleven canonical states per the
 * suite design pass plan (slice 2.5):
 *
 *   queued, running, ok, failed, cancelled, paused, stuck,
 *   errored, prepared, submitted, duplicate_skipped
 *
 * Visual treatment ported from bundle ma-primitives.jsx (`STATUS_META`),
 * extended to cover the plan's full state set. The bundle's `applying`/
 * `applied` map onto `running`/`ok`; the bundle's `needs_attention`/
 * `skipped`/`snoozed` are not part of the plan's 11 and are deliberately
 * omitted here. See task notes.
 */

export type StatusKind =
  | "queued"
  | "running"
  | "ok"
  | "failed"
  | "cancelled"
  | "paused"
  | "stuck"
  | "errored"
  | "prepared"
  | "submitted"
  | "duplicate_skipped";

interface Props {
  status: StatusKind;
  size?: "sm" | "lg";
}

interface Meta {
  label: string;
  glyph: string;
  color: string; // CSS var name fragment, e.g. "ok" → var(--ok)
  anim?: boolean;
}

export const STATUS_META: Record<StatusKind, Meta> = {
  queued:            { label: "Queued",      glyph: "◆", color: "haiku" },
  running:           { label: "Running",     glyph: "▶", color: "sonnet", anim: true },
  ok:                { label: "OK",          glyph: "✓", color: "ok" },
  failed:            { label: "Failed",      glyph: "✕", color: "err" },
  cancelled:         { label: "Cancelled",   glyph: "⊘", color: "ink-3" },
  paused:            { label: "Paused",      glyph: "‖", color: "warn" },
  stuck:             { label: "Stuck",       glyph: "!", color: "accent" },
  errored:           { label: "Errored",     glyph: "✕", color: "err" },
  prepared:          { label: "Prepared",    glyph: "◇", color: "ink-2" },
  submitted:         { label: "Submitted",   glyph: "↥", color: "ok" },
  duplicate_skipped: { label: "Duplicate",   glyph: "=", color: "ink-3" },
};

export default function StatusPill({ status, size = "sm" }: Props) {
  const meta = STATUS_META[status];
  if (!meta) return null;
  const fs = size === "lg" ? 12 : 10;
  const padY = size === "lg" ? 2 : 1;
  const padL = size === "lg" ? 7 : 6;
  const padR = size === "lg" ? 9 : 7;

  return (
    <span
      role="status"
      data-status={status}
      data-size={size}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: `${padY}px ${padR}px ${padY}px ${padL}px`,
        fontFamily: "var(--f-mono)",
        fontSize: fs,
        letterSpacing: "0.02em",
        color: `var(--${meta.color})`,
        background: "transparent",
        border: `1px solid var(--${meta.color})`,
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: fs - 1,
          lineHeight: 1,
          animation: meta.anim ? "blink 1.2s steps(1) infinite" : "none",
        }}
      >
        {meta.glyph}
      </span>
      {meta.label}
    </span>
  );
}
