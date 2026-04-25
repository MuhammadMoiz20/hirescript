import { ReactNode } from "react";

interface Props {
  label?: ReactNode;
  hint?: ReactNode;
  suffix?: ReactNode;
  children?: ReactNode;
}

export default function Field({ label, hint, suffix, children }: Props) {
  return (
    <label style={{ display: "block" }}>
      {label && <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>}
      <div style={{
        display: "flex", alignItems: "center",
        border: "1px solid var(--rule-strong)",
        background: "var(--paper)", borderRadius: 3,
      }}>
        {children}
        {suffix && <span style={{ padding: "0 10px", color: "var(--ink-3)", fontSize: 12 }}>{suffix}</span>}
      </div>
      {hint && <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>{hint}</div>}
    </label>
  );
}
