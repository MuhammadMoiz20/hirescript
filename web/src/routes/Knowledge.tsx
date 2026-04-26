import TopChrome from "../components/ui/TopChrome";

interface Props {
  onBack?: () => void;
}

export default function Knowledge({ onBack }: Props) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome onLogoClick={onBack}>Knowledge</TopChrome>
      <div style={{ padding: 24, color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
    </div>
  );
}
