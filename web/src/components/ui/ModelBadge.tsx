export type ModelName = "haiku" | "sonnet" | "opus";

interface Props {
  model: ModelName;
  size?: "sm" | "md";
}

const cfgMap: Record<ModelName, { label: string; hue: string }> = {
  haiku: { label: "Haiku 4.5", hue: "var(--haiku)" },
  sonnet: { label: "Sonnet 4.6", hue: "var(--sonnet)" },
  opus: { label: "Opus 4.7", hue: "var(--opus)" },
};

export default function ModelBadge({ model, size = "md" }: Props) {
  const cfg = cfgMap[model];
  const sizes = { sm: { fs: 10.5, padY: 1, padX: 5, dot: 5 }, md: { fs: 11.5, padY: 2, padX: 7, dot: 6 } }[size];
  return (
    <span className="mono" style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: `${sizes.padY}px ${sizes.padX}px`,
      border: "1px solid var(--rule)",
      borderRadius: 3,
      fontSize: sizes.fs, color: "var(--ink-2)", background: "var(--paper)",
      whiteSpace: "nowrap",
    }}>
      <span style={{ width: sizes.dot, height: sizes.dot, borderRadius: "50%", background: cfg.hue, display: "inline-block" }} />
      {cfg.label}
    </span>
  );
}
