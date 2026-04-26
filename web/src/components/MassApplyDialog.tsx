import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { enqueueTailorBatch, TailorItem } from "../api";
import Button from "./ui/Button";

interface Entry {
  title: string;
  company: string;
  url: string;
  jd_text: string;
}

interface Props {
  open: boolean;
  masterId: number;
  masterName: string;
  onClose: () => void;
}

const blankEntry = (): Entry => ({ title: "", company: "", url: "", jd_text: "" });

function entryValid(e: Entry): boolean {
  return e.title.trim().length > 0 && e.company.trim().length > 0 && e.jd_text.trim().length > 0;
}

export default function MassApplyDialog({ open, masterId, masterName, onClose }: Props) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Entry[]>([blankEntry()]);
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const allValid = entries.length > 0 && entries.every(entryValid);

  function update(idx: number, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  function addRow() {
    setEntries((prev) => [...prev, blankEntry()]);
  }

  function removeRow(idx: number) {
    setEntries((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function submit() {
    if (!allValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const items: TailorItem[] = entries.map((e) => {
        const item: TailorItem = {
          title: e.title.trim(),
          company: e.company.trim(),
          jd_text: e.jd_text,
        };
        const url = e.url.trim();
        if (url) item.url = url;
        return item;
      });
      const res = await enqueueTailorBatch({ resume_id: masterId, items, deep });
      onClose();
      navigate(`/jobs?batch=${res.batch_id}`);
    } catch (e: any) {
      setError(e?.message || "Failed to enqueue batch");
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Mass apply"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in oklch, var(--ink) 35%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--paper)",
          color: "var(--ink)",
          border: "1px solid var(--rule-strong)",
          borderRadius: 4,
          padding: "20px 22px",
          width: "min(720px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Mass apply</div>
          <h2 style={{ fontFamily: "var(--f-serif)", fontSize: 20, margin: 0, letterSpacing: "-0.01em" }}>
            Tailor "{masterName}" to multiple JDs
          </h2>
          <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "6px 0 0" }}>
            Each entry queues a separate tailor job. Watch progress on the Jobs page.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {entries.map((entry, idx) => (
            <div
              key={idx}
              data-testid="mass-apply-entry"
              style={{
                border: "1px solid var(--rule)",
                borderRadius: 4,
                padding: 12,
                background: "var(--paper-2)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  JD {idx + 1}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeRow(idx)}
                  disabled={entries.length <= 1}
                >
                  Remove
                </Button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="eyebrow">Title</span>
                  <input
                    aria-label={`Title ${idx + 1}`}
                    value={entry.title}
                    onChange={(e) => update(idx, { title: e.target.value })}
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="eyebrow">Company</span>
                  <input
                    aria-label={`Company ${idx + 1}`}
                    value={entry.company}
                    onChange={(e) => update(idx, { company: e.target.value })}
                    style={inputStyle}
                  />
                </label>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="eyebrow">URL (optional)</span>
                <input
                  aria-label={`URL ${idx + 1}`}
                  value={entry.url}
                  onChange={(e) => update(idx, { url: e.target.value })}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="eyebrow">Job description</span>
                <textarea
                  aria-label={`Job description ${idx + 1}`}
                  value={entry.jd_text}
                  onChange={(e) => update(idx, { jd_text: e.target.value })}
                  rows={5}
                  style={{ ...inputStyle, fontFamily: "var(--f-sans)", resize: "vertical", minHeight: 90 }}
                />
              </label>
            </div>
          ))}
        </div>

        <div>
          <Button size="sm" icon="plus" onClick={addRow}>
            Add another JD
          </Button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={deep}
            onChange={(e) => setDeep(e.target.checked)}
          />
          Deep tailor (Opus 4.7) — slower, applied to every JD in this batch
        </label>

        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: "8px 12px",
              border: "1px solid var(--accent)",
              background: "color-mix(in oklch, var(--accent) 10%, var(--paper))",
              borderRadius: 3,
              fontSize: 13,
              color: "var(--ink)",
            }}
          >
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!allValid || busy}>
            {busy ? "Queuing…" : `Submit ${entries.length} job${entries.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--rule-strong)",
  borderRadius: 3,
  background: "var(--paper)",
  color: "var(--ink)",
  padding: "6px 8px",
  fontSize: 13,
  outline: "none",
  fontFamily: "var(--f-sans)",
};
