import Glyph, { GlyphName } from "./Glyph";

/**
 * PageCountBadge state model.
 *
 * Six logical states per the suite design bundle, supplied either as a
 * canonical string token or — for compile results — a raw integer page count.
 *
 *  - "ok"       → exactly 1 page (preferred numeric form: 1)
 *  - "over"     → more than 1 page, exact count unknown
 *                 (preferred numeric form: any number ≠ 1)
 *  - "compiling"→ in flight
 *  - "error"    → compile failed
 *  - "unknown"  → not yet compiled / no signal
 *  - "final"    → published / locked artifact, treated as ok with a lock tone
 *
 * Numeric values are accepted directly so callers can pass `result.page_count`
 * straight through from the API.
 */
export type PageCountState =
  | "ok"
  | "over"
  | "compiling"
  | "error"
  | "unknown"
  | "final"
  | "err" // legacy alias for "over"
  | number;

interface Props {
  state: PageCountState;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

interface Cfg { glyph: GlyphName; label: string; tone: "ok" | "err" | "muted" | "final" }

export default function PageCountBadge({ state, size = "md", showLabel = true }: Props) {
  const cfg: Cfg = (() => {
    if (state === "ok" || state === 1) return { glyph: "check", label: "1 page", tone: "ok" };
    if (state === "final") return { glyph: "check", label: "final", tone: "final" };
    if (state === "over" || state === "err") return { glyph: "cross", label: "over 1 page", tone: "err" };
    if (typeof state === "number" && state !== 1) return { glyph: "cross", label: `${state} pages`, tone: "err" };
    if (state === "compiling") return { glyph: "dots", label: "compiling", tone: "muted" };
    if (state === "error") return { glyph: "warn", label: "compile error", tone: "err" };
    return { glyph: "dash", label: "unknown", tone: "muted" };
  })();

  const tones = {
    ok:    { bg: "var(--ok-soft)",  fg: "var(--ok)",    bd: "color-mix(in oklch, var(--ok) 25%, transparent)" },
    err:   { bg: "var(--err-soft)", fg: "var(--err)",   bd: "color-mix(in oklch, var(--err) 30%, transparent)" },
    muted: { bg: "var(--paper-2)",  fg: "var(--ink-3)", bd: "var(--rule)" },
    final: { bg: "var(--paper-2)",  fg: "var(--ink)",   bd: "var(--rule-strong)" },
  }[cfg.tone];

  const sizes = {
    sm: { padY: 1, padX: 5, fs: 10.5, gap: 3, gs: 10 },
    md: { padY: 2, padX: 7, fs: 11.5, gap: 4, gs: 12 },
    lg: { padY: 4, padX: 10, fs: 13, gap: 6, gs: 14 },
  }[size];

  return (
    <span
      role="status"
      className="mono"
      data-state={typeof state === "number" ? (state === 1 ? "ok" : "over") : state === "err" ? "over" : state}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sizes.gap,
        padding: `${sizes.padY}px ${sizes.padX}px`,
        background: tones.bg,
        color: tones.fg,
        border: `1px solid ${tones.bd}`,
        borderRadius: 3,
        fontSize: sizes.fs,
        fontWeight: 500,
        lineHeight: 1,
        letterSpacing: "0.01em",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
      title={`Page count: ${cfg.label}`}
    >
      <span style={{ display: "inline-flex", animation: state === "compiling" ? "blink 1.2s steps(1) infinite" : "none" }}>
        <Glyph name={cfg.glyph} size={sizes.gs} stroke={2} />
      </span>
      {showLabel && <span>{cfg.label}</span>}
    </span>
  );
}
