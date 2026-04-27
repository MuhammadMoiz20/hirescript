/**
 * FitChip — mass-apply primitive.
 *
 * Displays a job-fit score in 0–100 with a coarse band:
 *   - ≥85         → strong   (ok hue)
 *   - 60–84       → moderate (warn hue)
 *   - 40–59       → weak     (accent hue)
 *   - <40         → muted    (ink-3)
 *   - null/NaN    → unknown  (renders "—/100")
 *
 * Visual treatment ported from bundle ma-primitives.jsx (mono, outlined, soft fill).
 */

export type FitBand = "strong" | "moderate" | "weak" | "muted" | "unknown";

interface Props {
  score: number | null;
  size?: "sm" | "lg";
}

export function bandFor(score: number | null): FitBand {
  if (score == null || Number.isNaN(score)) return "unknown";
  if (score >= 85) return "strong";
  if (score >= 60) return "moderate";
  if (score >= 40) return "weak";
  return "muted";
}

const TONE: Record<FitBand, { fg: string; bg: string; bd: string }> = {
  strong:   { fg: "var(--ok)",     bg: "var(--ok-soft)",     bd: "var(--ok)" },
  moderate: { fg: "var(--warn)",   bg: "var(--warn-soft)",   bd: "var(--warn)" },
  weak:     { fg: "var(--accent)", bg: "var(--accent-soft)", bd: "var(--accent)" },
  muted:    { fg: "var(--ink-3)",  bg: "var(--paper-3)",     bd: "var(--rule)" },
  unknown:  { fg: "var(--ink-3)",  bg: "var(--paper-2)",     bd: "var(--rule)" },
};

export default function FitChip({ score, size = "sm" }: Props) {
  const band = bandFor(score);
  const tone = TONE[band];
  const fs = size === "lg" ? 14 : 11;
  const padY = size === "lg" ? 3 : 1;
  const padX = size === "lg" ? 8 : 6;
  const display = band === "unknown" ? "—" : String(Math.round(score as number));

  return (
    <span
      data-band={band}
      data-size={size}
      title={
        band === "unknown"
          ? "Fit unknown"
          : `Fit ${display}/100 — ${band}`
      }
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 3,
        padding: `${padY}px ${padX}px`,
        fontFamily: "var(--f-mono)",
        fontSize: fs,
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.bd}`,
        borderRadius: 2,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span style={{ fontWeight: 600 }}>{display}</span>
      <span style={{ fontSize: fs - 3, opacity: 0.7 }}>/100</span>
    </span>
  );
}
