import { ReactNode } from "react";
import Glyph from "./Glyph";

/**
 * ProtectedTermPill — a pill rendering an ATS verb, JD keyword, or pinned
 * term that AI edits must preserve.
 *
 *  - variant="preserved" (default) → green outline, content kept across edits
 *  - variant="removed"             → red filled, with a strike-style cross
 *
 * `onRemove`, when supplied, renders a small cross button after the label so
 * users can drop a term from their protected set.
 */
interface Props {
  children: ReactNode;
  variant?: "preserved" | "removed";
  onRemove?: () => void;
}

export default function ProtectedTermPill({ children, variant = "preserved", onRemove }: Props) {
  const sty = variant === "preserved"
    ? { bg: "transparent", fg: "var(--ok)", bd: "color-mix(in oklch, var(--ok) 40%, transparent)" }
    : { bg: "var(--err-soft)", fg: "var(--err)", bd: "color-mix(in oklch, var(--err) 30%, transparent)" };
  return (
    <span
      className="mono"
      data-variant={variant}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "2px 7px",
        border: `1px solid ${sty.bd}`,
        background: sty.bg,
        color: sty.fg,
        fontSize: 11,
        borderRadius: 3,
        whiteSpace: "nowrap",
      }}
    >
      {variant === "removed" && <Glyph name="cross" size={10} stroke={2} />}
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          style={{ color: "inherit", opacity: 0.6, display: "inline-flex", background: "transparent", border: 0, padding: 0, cursor: "pointer" }}
          title="Remove"
          aria-label="Remove"
        >
          <Glyph name="cross" size={10} stroke={2} />
        </button>
      )}
    </span>
  );
}
