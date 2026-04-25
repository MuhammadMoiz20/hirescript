import Button from "../ui/Button";
import PageCountBadge from "../ui/PageCountBadge";

interface Props {
  resumeName: string;
  onBack: () => void;
  onSave: () => void;
  onCompile: () => void;
  saving?: boolean;
  compiling?: boolean;
  pageCount?: number | null;
  autosaveLabel?: string;
}

export default function EditorToolbar({
  resumeName,
  onBack,
  onSave,
  onCompile,
  saving = false,
  compiling = false,
  pageCount,
  autosaveLabel,
}: Props) {
  return (
    <div
      style={{
        padding: "8px 14px",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--paper)",
        flexShrink: 0,
      }}
    >
      <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back">
        Back
      </Button>
      <span
        className="mono"
        style={{
          fontSize: 12,
          color: "var(--ink-3)",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>Library</span>
        <span style={{ color: "var(--rule-strong)" }}>/</span>
        <strong style={{ color: "var(--ink)", fontWeight: 600 }}>{resumeName || "—"}</strong>
      </span>
      <div style={{ flex: 1 }} />
      {autosaveLabel && (
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {autosaveLabel}
        </span>
      )}
      {pageCount != null && (
        <PageCountBadge state={compiling ? "compiling" : pageCount} size="sm" />
      )}
      <Button size="sm" icon="check" onClick={onSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
      <Button size="sm" variant="primary" icon="compile" onClick={onCompile} disabled={compiling}>
        {compiling ? "Compiling…" : "Compile"}
      </Button>
    </div>
  );
}
