/**
 * Sparkline — mass-apply primitive.
 *
 * 14-day applied-jobs sparkline. Pure SVG, no external library.
 *
 * `data` is an array of numbers (length 14 expected for the canonical
 * "last 2 weeks" use, but any length ≥ 1 renders). Final point is
 * highlighted with a small dot to anchor "today."
 *
 * The polyline is drawn into a fixed viewBox so callers can scale via CSS
 * by overriding `width`/`height`.
 */

interface Props {
  data: number[];
  width?: number;
  height?: number;
  ariaLabel?: string;
  /** Stroke color CSS value. Defaults to var(--ink-2). */
  stroke?: string;
  /** Soft fill under the line. Off by default for compact use. */
  fill?: boolean;
}

export default function Sparkline({
  data,
  width = 120,
  height = 28,
  ariaLabel,
  stroke = "var(--ink-2)",
  fill = false,
}: Props) {
  if (!data || data.length === 0) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel ?? "No sparkline data"}
        data-empty="true"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      />
    );
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pad = 2;
  const innerH = height - pad * 2;

  const points = data.map((v, i) => {
    const x = data.length === 1 ? width / 2 : (i / (data.length - 1)) * width;
    const y = height - ((v - min) / span) * innerH - pad;
    return [x, y] as const;
  });

  const path = "M " + points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L ");
  const last = points[points.length - 1];

  const total = data.reduce((sum, n) => sum + n, 0);
  const label =
    ariaLabel ??
    `Applied jobs over the last ${data.length} day${data.length === 1 ? "" : "s"}: ${total} total`;

  return (
    <svg
      role="img"
      aria-label={label}
      data-points={data.length}
      data-min={min}
      data-max={max}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", overflow: "visible" }}
    >
      {fill && (
        <path
          data-part="fill"
          d={`${path} L ${width.toFixed(2)},${height.toFixed(2)} L 0,${height.toFixed(2)} Z`}
          fill="var(--paper-3)"
          stroke="none"
        />
      )}
      <path
        data-part="line"
        d={path}
        stroke={stroke}
        strokeWidth={1.5}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        data-part="dot"
        cx={last[0]}
        cy={last[1]}
        r={2}
        fill={stroke}
      />
    </svg>
  );
}
