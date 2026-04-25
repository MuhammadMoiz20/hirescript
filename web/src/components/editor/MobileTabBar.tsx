export type MobileTab = "edit" | "preview" | "chat" | "history";

const TABS: { id: MobileTab; label: string }[] = [
  { id: "edit", label: "Edit" },
  { id: "preview", label: "Preview" },
  { id: "chat", label: "Chat" },
  { id: "history", label: "History" },
];

interface Props {
  value: MobileTab;
  onChange: (t: MobileTab) => void;
}

export default function MobileTabBar({ value, onChange }: Props) {
  return (
    <nav
      role="tablist"
      style={{
        height: "var(--bottom-chrome)",
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        borderTop: "1px solid var(--rule)",
        background: "var(--paper)",
        paddingBottom: "env(safe-area-inset-bottom)",
        flexShrink: 0,
      }}
    >
      {TABS.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            style={{
              fontSize: 12,
              fontFamily: "var(--f-mono)",
              color: active ? "var(--ink)" : "var(--ink-3)",
              borderTop: active ? "2px solid var(--ink)" : "2px solid transparent",
              background: "transparent",
              border: "none",
              borderTopWidth: 2,
              borderTopStyle: "solid",
              borderTopColor: active ? "var(--ink)" : "transparent",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
