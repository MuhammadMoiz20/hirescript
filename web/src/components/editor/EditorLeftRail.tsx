import Glyph, { GlyphName } from "../ui/Glyph";

export type EditorView = "form" | "latex" | "history";

interface Props {
  view: EditorView;
  onChange: (next: EditorView) => void;
  disabled?: boolean;
}

interface Item {
  id: EditorView;
  label: string;
  glyph: GlyphName;
}

const ITEMS: Item[] = [
  { id: "form", label: "Form", glyph: "form" },
  { id: "latex", label: "LaTeX", glyph: "latex" },
  { id: "history", label: "History", glyph: "history" },
];

export default function EditorLeftRail({ view, onChange, disabled }: Props) {
  return (
    <aside
      style={{
        width: 48,
        borderRight: "1px solid var(--rule)",
        background: "var(--paper)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "10px 0",
        gap: 4,
        flexShrink: 0,
      }}
    >
      {ITEMS.map((it) => {
        const active = view === it.id;
        return (
          <button
            key={it.id}
            type="button"
            aria-label={it.label}
            title={it.label}
            disabled={disabled}
            onClick={() => onChange(it.id)}
            style={{
              width: 32,
              height: 32,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 3,
              background: active ? "var(--paper-3)" : "transparent",
              color: active ? "var(--ink)" : "var(--ink-3)",
              border: active ? "1px solid var(--rule)" : "1px solid transparent",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Glyph name={it.glyph} size={14} />
          </button>
        );
      })}
    </aside>
  );
}
