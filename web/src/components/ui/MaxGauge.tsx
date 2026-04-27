/**
 * MaxGauge — mass-apply primitive.
 *
 * Horizontal band gauge for "Max-window headroom." Visualises the percentage
 * of the rolling Anthropic max-window budget the user has consumed. Crosses
 * three bands:
 *
 *   - 0–74%   → ok    (green)
 *   - 75–89%  → warn  (amber)
 *   - 90–100% → err   (accent / red)
 *
 * Two sizes:
 *   - "compact"  : top-bar treatment (~24px tall, percentage label only).
 *   - "expanded" : dashboard treatment (band stops + reset countdown visible).
 *
 * `usedPct` is clamped to [0, 100]. `resetsAt` is a Date used to compute a
 * human countdown in the expanded variant.
 */

export type GaugeBand = "ok" | "warn" | "err";

interface Props {
  usedPct: number;
  resetsAt: Date;
  size?: "compact" | "expanded";
}

export function bandFor(pct: number): GaugeBand {
  if (pct >= 90) return "err";
  if (pct >= 75) return "warn";
  return "ok";
}

const BAND_STOPS: { pct: number; band: GaugeBand }[] = [
  { pct: 75, band: "warn" },
  { pct: 90, band: "err" },
];

/** Format a "resets in Xh Ym" string from a future Date. Past → "now". */
export function formatResetsIn(now: Date, resetsAt: Date): string {
  const ms = resetsAt.getTime() - now.getTime();
  if (ms <= 0) return "resets now";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `resets in ${m}m`;
  return `resets in ${h}h ${m}m`;
}

const BAND_VAR: Record<GaugeBand, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
};

export default function MaxGauge({ usedPct, resetsAt, size = "compact" }: Props) {
  const pct = Math.max(0, Math.min(100, usedPct));
  const band = bandFor(pct);
  const fill = BAND_VAR[band];
  const isExpanded = size === "expanded";
  const trackHeight = isExpanded ? 8 : 4;
  const trackWidth = isExpanded ? 220 : 96;
  const fontSize = isExpanded ? 12 : 10;

  return (
    <div
      role="meter"
      aria-label="Max-window headroom"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      data-size={size}
      data-band={band}
      data-pct={Math.round(pct)}
      title={`Max-window: ${Math.round(pct)}% used`}
      style={{
        display: "inline-flex",
        flexDirection: isExpanded ? "column" : "row",
        alignItems: isExpanded ? "stretch" : "center",
        gap: isExpanded ? 6 : 8,
        fontFamily: "var(--f-mono)",
        fontSize,
        color: "var(--ink-2)",
      }}
    >
      {isExpanded && (
        <div
          data-part="header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            color: "var(--ink-3)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontSize: 10,
          }}
        >
          <span>Max-window</span>
          <span data-part="pct" style={{ color: fill, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
            {Math.round(pct)}%
          </span>
        </div>
      )}
      <div
        data-part="track"
        style={{
          position: "relative",
          width: trackWidth,
          height: trackHeight,
          background: "var(--gauge-track)",
          border: "1px solid var(--rule)",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        <div
          data-part="fill"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: fill,
            transition: "width 200ms linear",
          }}
        />
        {isExpanded &&
          BAND_STOPS.map((stop) => (
            <div
              key={stop.band}
              data-part="band-stop"
              data-stop={stop.band}
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${stop.pct}%`,
                width: 1,
                background: BAND_VAR[stop.band],
                opacity: 0.6,
              }}
            />
          ))}
      </div>
      {!isExpanded && (
        <span data-part="pct" style={{ color: fill, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {Math.round(pct)}%
        </span>
      )}
      {isExpanded && (
        <div
          data-part="resets"
          style={{ color: "var(--ink-3)", fontSize: 11 }}
        >
          {formatResetsIn(new Date(), resetsAt)}
        </div>
      )}
    </div>
  );
}
