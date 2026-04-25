import { ButtonHTMLAttributes, ReactNode } from "react";
import Glyph, { GlyphName } from "./Glyph";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: GlyphName;
  iconRight?: GlyphName;
  mono?: boolean;
  kbd?: string;
}

export default function Button({
  children, variant = "default", size = "md", disabled, icon, iconRight, mono, kbd, style, ...rest
}: Props) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: size === "sm" ? "4px 9px" : size === "lg" ? "9px 16px" : "6px 12px",
    fontSize: size === "sm" ? 12 : size === "lg" ? 14 : 13,
    border: "1px solid var(--rule-strong)",
    background: "var(--paper)",
    color: "var(--ink)",
    borderRadius: 3,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    transition: "background 120ms, border-color 120ms",
    fontFamily: mono ? "var(--f-mono)" : "var(--f-sans)",
    letterSpacing: mono ? "0.01em" : "0",
    whiteSpace: "nowrap",
  };
  const variants: Record<ButtonVariant, React.CSSProperties> = {
    default: {},
    primary: { background: "var(--ink)", color: "var(--paper)", borderColor: "var(--ink)" },
    ghost: { background: "transparent", borderColor: "transparent", color: "var(--ink-2)" },
    danger: { background: "var(--accent)", color: "var(--paper)", borderColor: "var(--accent)" },
    subtle: { background: "var(--paper-2)", borderColor: "var(--rule)" },
  };

  return (
    <button
      {...rest}
      data-variant={variant}
      data-size={size}
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={(e) => {
        if (!disabled && variant === "default") e.currentTarget.style.background = "var(--paper-2)";
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (!disabled && variant === "default") e.currentTarget.style.background = "var(--paper)";
        rest.onMouseLeave?.(e);
      }}
    >
      {icon && <span style={{ display: "inline-flex", opacity: 0.9 }}><Glyph name={icon} size={13} /></span>}
      {children != null && <span>{children}</span>}
      {iconRight && <span style={{ display: "inline-flex", opacity: 0.8 }}><Glyph name={iconRight} size={13} /></span>}
      {kbd && (
        <span className="mono" style={{
          fontSize: 10.5, color: "currentColor", opacity: 0.55,
          border: "1px solid color-mix(in oklch, currentColor 30%, transparent)",
          padding: "1px 4px", borderRadius: 2, marginLeft: 4,
        }}>{kbd}</span>
      )}
    </button>
  );
}
