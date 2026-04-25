import { useState } from "react";
import { api, TailorResponse } from "../api";
import Button from "./ui/Button";
import Field from "./ui/Field";
import Input from "./ui/Input";
import Textarea from "./ui/Textarea";

interface Props {
  masterId: number;
  masterName: string;
  open: boolean;
  onClose: () => void;
  onCreated: (response: TailorResponse) => void;
}

export default function TailorModal({ masterId, masterName, open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [deepTailor, setDeepTailor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const valid = title.trim() && company.trim() && jdText.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api.tailorToJd(masterId, {
        title: title.trim(),
        company: company.trim(),
        url: url.trim() || undefined,
        jd_text: jdText,
        deep_tailor: deepTailor,
      });
      onCreated(res);
      // Reset
      setTitle(""); setCompany(""); setUrl(""); setJdText(""); setDeepTailor(false);
    } catch (e: any) {
      const detail = e?.detail;
      if (detail?.error === "not_one_page") setError(`Tailored resume came out at ${detail.page_count} pages after ${detail.iterations} repair attempts.`);
      else setError(e?.message || "Tailor failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Tailor to JD"
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in oklch, var(--ink) 35%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: "var(--paper)",
          color: "var(--ink)",
          border: "1px solid var(--rule-strong)",
          borderRadius: 4,
          padding: 24,
          minWidth: 720,
          maxWidth: 880,
          width: "90vw",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "none",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Header */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>New variant</div>
          <h2
            style={{
              fontFamily: "var(--f-serif)",
              fontSize: 24,
              letterSpacing: "-0.015em",
              margin: "0 0 4px",
            }}
          >
            Tailor to JD
          </h2>
          <p
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-3)", margin: 0 }}
          >
            Generate a job-specific variant from {masterName}.
          </p>
        </div>

        {/* Two-column form */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.2fr",
            gap: 16,
          }}
        >
          {/* Left: meta inputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Payments Infrastructure Engineer"
              />
            </Field>
            <Field label="Company">
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Stripe"
              />
            </Field>
            <Field label="URL">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </Field>
          </div>

          {/* Right: JD textarea */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Field label="Job description">
              <Textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                rows={12}
                placeholder="Paste the job description here…"
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  minHeight: 240,
                }}
              />
            </Field>
          </div>
        </div>

        {/* Deep tailor toggle */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            border: "1px solid var(--rule)",
            borderRadius: 3,
            padding: "10px 12px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={deepTailor}
            onChange={(e) => setDeepTailor(e.target.checked)}
            style={{ accentColor: "var(--ink)" }}
          />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              Deep tailor (Opus 4.7)
            </span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-3)" }}
            >
              Slower, more expensive. Reorders bullets and rewrites for voice.
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" style={{ color: "var(--err)", fontSize: 13, margin: 0 }}>
            {error}
          </p>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            justifyContent: "flex-end",
            paddingTop: 12,
            borderTop: "1px solid var(--rule)",
          }}
        >
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="sparkle"
            disabled={!valid || busy}
          >
            {busy ? "Tailoring…" : "Tailor"}
          </Button>
        </div>
      </form>
    </div>
  );
}
