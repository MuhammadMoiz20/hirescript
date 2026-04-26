import Button from "./ui/Button";

interface Props {
  pageCount: number;
  overflowCount?: number;
  onTighten: () => void;
  busy?: boolean;
}

export default function OverflowBanner({
  pageCount, overflowCount = 0, onTighten, busy = false,
}: Props) {
  const pageOverflow = pageCount > 1;
  const lineOverflow = overflowCount > 0;
  if (!pageOverflow && !lineOverflow) return null;

  const badge = pageOverflow
    ? `${pageCount} pages`
    : `${overflowCount} line${overflowCount === 1 ? "" : "s"} overflow`;
  const message = pageOverflow
    ? "Resume overflows onto a second page. Fix it before saving as final, or have Claude tighten it without dropping ATS keywords or action verbs."
    : "Some bullets bleed past the right margin and wrap with one or two orphan words — looks unprofessional and wastes vertical space. Claude can tighten them without dropping ATS keywords or action verbs.";
  const buttonLabel = busy
    ? "Tightening…"
    : pageOverflow ? "Ask Claude to tighten" : "Fix line overflows";

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
        {badge}
      </span>
      <span style={{ flex: 1 }}>{message}</span>
      <Button onClick={onTighten} disabled={busy} variant="primary" size="sm">
        {buttonLabel}
      </Button>
    </div>
  );
}
