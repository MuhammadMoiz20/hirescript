import { ReactNode } from "react";
import Glyph from "./Glyph";

interface Props {
  children: ReactNode;
  variant?: "preserved" | "removed";
  onRemove?: () => void;
}

export default function TermPill({ children, variant = "preserved", onRemove }: Props) {
  const sty = variant === "preserved"
    ? { bg: "transparent", fg: "var(--ok)", bd: "color-mix(in oklch, var(--ok) 40%, transparent)" }
    : { bg: "var(--err-soft)", fg: "var(--err)", bd: "color-mix(in oklch, var(--err) 30%, transparent)" };
  return (
    <span className="mono" style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 7px",
      border: `1px solid ${sty.bd}`,
      background: sty.bg,
      color: sty.fg,
      fontSize: 11,
      borderRadius: 3,
      whiteSpace: "nowrap",
    }}>
      {variant === "removed" && <Glyph name="cross" size={10} stroke={2} />}
      {children}
      {onRemove && (
        <button onClick={onRemove} style={{ color: "inherit", opacity: 0.6, display: "inline-flex" }} title="Remove" aria-label="Remove">
          <Glyph name="cross" size={10} stroke={2} />
        </button>
      )}
    </span>
  );
}
