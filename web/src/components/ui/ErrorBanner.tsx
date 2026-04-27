/**
 * ErrorBanner — shared red-ink alert primitive.
 *
 * Voice: matter-of-fact, no apologies. Optional retry button.
 */
export interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  /** Optional dismiss handler — renders a small "dismiss" link. */
  onDismiss?: () => void;
  testid?: string;
}

export default function ErrorBanner({
  message,
  onRetry,
  onDismiss,
  testid,
}: ErrorBannerProps) {
  return (
    <div
      role="alert"
      data-testid={testid}
      style={{
        border: "1px solid var(--accent)",
        background: "color-mix(in oklch, var(--accent) 10%, var(--paper))",
        padding: "8px 12px",
        fontSize: 13,
        color: "var(--ink)",
        borderRadius: 3,
        display: "flex",
        alignItems: "center",
        gap: 12,
        justifyContent: "space-between",
      }}
    >
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {message}
      </span>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              padding: "4px 10px",
              border: "1px solid var(--accent)",
              background: "transparent",
              color: "var(--accent)",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              padding: "4px 8px",
              border: "1px solid transparent",
              background: "transparent",
              color: "var(--ink-3)",
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
