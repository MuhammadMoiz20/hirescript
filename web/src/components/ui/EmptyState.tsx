/**
 * EmptyState — bundle-aligned shared empty state primitive.
 *
 * Mirrors the EmptyState used across the HireScript Suite design bundle
 * (`ma-primitives.jsx::EmptyState`). Centered layout in a paper card with
 * rule border. Voice: matter-of-fact, lowercase, never apologetic.
 */
import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** Short heading. Sentence case, no trailing period. */
  title: string;
  /** Optional supporting body — one sentence. */
  body?: string;
  /** Optional glyph (single character) shown above the title. Defaults to "◌". */
  glyph?: string;
  /** Optional react node alternative to glyph (icon component). */
  icon?: ReactNode;
  /** Optional CTA button. */
  cta?: { label: string; onClick: () => void };
  /** Test id hook. */
  testid?: string;
  /** Variant: "card" (default, full panel padding) or "inline" (smaller, dashed border). */
  variant?: "card" | "inline";
}

export default function EmptyState({
  title,
  body,
  glyph = "◌",
  icon,
  cta,
  testid,
  variant = "card",
}: EmptyStateProps) {
  const isInline = variant === "inline";
  return (
    <div
      data-testid={testid}
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: isInline ? "20px 16px" : "48px 32px",
        textAlign: "center",
        color: "var(--ink-3)",
        background: isInline ? "transparent" : "var(--paper)",
        border: isInline ? "1px dashed var(--rule)" : "1px solid var(--rule)",
        borderRadius: 3,
        gap: 6,
      }}
    >
      <div
        aria-hidden
        className="mono"
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: isInline ? 18 : 26,
          color: "var(--ink-3)",
          marginBottom: isInline ? 4 : 10,
          lineHeight: 1,
        }}
      >
        {icon ?? glyph}
      </div>
      <div
        className="serif"
        style={{
          fontFamily: "var(--f-serif)",
          fontSize: isInline ? 15 : 18,
          color: "var(--ink)",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </div>
      {body && (
        <div
          style={{
            fontSize: 13,
            maxWidth: 380,
            lineHeight: 1.5,
            color: "var(--ink-3)",
            marginBottom: cta ? 10 : 0,
          }}
        >
          {body}
        </div>
      )}
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          style={{
            marginTop: 8,
            padding: "8px 14px",
            border: "1px solid var(--ink)",
            background: "var(--ink)",
            color: "var(--paper)",
            fontFamily: "var(--f-mono)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}
