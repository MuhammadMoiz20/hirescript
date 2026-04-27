/**
 * LoadingSkeleton — shared shimmer rows primitive.
 *
 * Matches the muted shimmer look used on Overview/Dashboard skeleton lists.
 * Always sets role="status" + aria-label="Loading" for assistive tech.
 */
export interface LoadingSkeletonProps {
  rows?: number;
  height?: number;
  /** Optional gap (px) between rows. */
  gap?: number;
  testid?: string;
  /** Override accessible label, default "Loading". */
  ariaLabel?: string;
}

export default function LoadingSkeleton({
  rows = 3,
  height = 28,
  gap = 6,
  testid,
  ariaLabel = "Loading",
}: LoadingSkeletonProps) {
  return (
    <div
      data-testid={testid}
      role="status"
      aria-label={ariaLabel}
      style={{ display: "flex", flexDirection: "column", gap }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            height,
            borderRadius: 3,
            background:
              "linear-gradient(90deg, var(--paper-3) 0%, var(--paper-2) 50%, var(--paper-3) 100%)",
            border: "1px solid var(--rule)",
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}
