import Glyph, { GlyphName } from "./Glyph";

export type PageCountState = "ok" | "err" | "unknown" | "compiling" | "error" | number;

interface Props {
  state: PageCountState;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

interface Cfg { glyph: GlyphName; label: string; tone: "ok" | "err" | "muted" }

export default function PageCountBadge({ state, size = "md", showLabel = true }: Props) {
  const cfg: Cfg = (() => {
    if (state === "ok" || state === 1) return { glyph: "check", label: "1 page", tone: "ok" };
    if (state === "err") return { glyph: "cross", label: "over 1 page", tone: "err" };
    if (typeof state === "number" && state !== 1) return { glyph: "cross", label: `${state} pages`, tone: "err" };
    if (state === "compiling") return { glyph: "dots", label: "compiling", tone: "muted" };
    if (state === "error") return { glyph: "warn", label: "compile error", tone: "err" };
    return { glyph: "dash", label: "unknown", tone: "muted" };
  })();

  const tones = {
    ok: { bg: "var(--ok-soft)", fg: "var(--ok)", bd: "color-mix(in oklch, var(--ok) 25%, transparent)" },
    err: { bg: "var(--err-soft)", fg: "var(--err)", bd: "color-mix(in oklch, var(--err) 30%, transparent)" },
    muted: { bg: "var(--paper-2)", fg: "var(--ink-3)", bd: "var(--rule)" },
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
