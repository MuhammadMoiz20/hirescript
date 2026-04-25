import Button from "./ui/Button";

interface Props {
  pageCount: number;
  onTighten: () => void;
  busy?: boolean;
}

export default function OverflowBanner({ pageCount, onTighten, busy = false }: Props) {
  if (pageCount <= 1) return null;
  return (
    <div role="alert" style={{
      background: "var(--err-soft)",
      border: "1px solid var(--err)",
      color: "var(--ink)",
      padding: "10px 14px",
      borderRadius: 4,
      display: "flex",
      alignItems: "center",
      gap: 12,
      marginBottom: 12,
    }}>
      <span className="mono" style={{ fontSize: 12, color: "var(--err)", fontWeight: 600 }}>
        {pageCount} pages
      </span>
      <span style={{ flex: 1 }}>
        Resume overflows. Fix it before saving as final, or have Claude tighten without dropping protected terms.
      </span>
      <Button onClick={onTighten} disabled={busy} variant="primary" size="sm">
        {busy ? "Tightening…" : "Ask Claude to tighten"}
      </Button>
    </div>
  );
}
