import { useEffect, useRef, useState } from "react";
import Glyph, { GlyphName } from "./Glyph";

export type KebabItem = {
  label: string;
  icon?: GlyphName;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

interface Props {
  items: KebabItem[];
  label?: string;
}

export default function KebabMenu({ items, label = "More actions" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          border: "1px solid transparent",
          background: "transparent",
          color: "var(--ink-2)",
          borderRadius: 3,
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--paper-2)";
          e.currentTarget.style.borderColor = "var(--rule)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.borderColor = "transparent";
        }}
      >
        <Glyph name="dots" size={16} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            marginTop: 4,
            minWidth: 180,
            background: "var(--paper)",
            border: "1px solid var(--rule-strong)",
            borderRadius: 4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            zIndex: 30,
            padding: 4,
          }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "7px 10px",
                fontSize: 13,
                background: "transparent",
                border: "none",
                textAlign: "left",
                cursor: it.disabled ? "not-allowed" : "pointer",
                color: it.danger ? "var(--accent)" : "var(--ink)",
                opacity: it.disabled ? 0.5 : 1,
                borderRadius: 3,
              }}
              onMouseEnter={(e) => {
                if (!it.disabled) e.currentTarget.style.background = "var(--paper-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {it.icon && <Glyph name={it.icon} size={13} />}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
