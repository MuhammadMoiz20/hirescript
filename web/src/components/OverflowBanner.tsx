interface Props {
  pageCount: number;
  onTighten: () => void;
  busy?: boolean;
}

export default function OverflowBanner({ pageCount, onTighten, busy = false }: Props) {
  if (pageCount <= 1) return null;
  return (
    <div role="alert" style={{
      background: "#fee", border: "1px solid #c00", color: "#900",
      padding: "8px 12px", marginBottom: 8, borderRadius: 4,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <span>
        Resume is {pageCount} pages. Fix before saving as final, or ask Claude to
        tighten without dropping protected terms.
      </span>
      <button
        type="button"
        onClick={onTighten}
        disabled={busy}
        style={{ marginLeft: "auto" }}
      >
        {busy ? "Tightening…" : "Ask Claude to tighten"}
      </button>
    </div>
  );
}
