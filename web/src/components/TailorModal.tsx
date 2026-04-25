import { useState } from "react";
import { api, TailorResponse } from "../api";

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
    <div role="dialog" aria-label="Tailor to JD" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={submit} style={{ background: "white", padding: 24, minWidth: 480, maxWidth: 640, borderRadius: 8 }}>
        <h2>Tailor "{masterName}" to a job</h2>
        <label style={{ display: "block", marginTop: 8 }}>Title <input value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label style={{ display: "block", marginTop: 8 }}>Company <input value={company} onChange={e => setCompany(e.target.value)} /></label>
        <label style={{ display: "block", marginTop: 8 }}>URL <input value={url} onChange={e => setUrl(e.target.value)} /></label>
        <label style={{ display: "block", marginTop: 8 }}>Job description
          <textarea value={jdText} onChange={e => setJdText(e.target.value)} rows={10} style={{ width: "100%" }} />
        </label>
        <label style={{ display: "block", marginTop: 8 }}>
          <input type="checkbox" checked={deepTailor} onChange={e => setDeepTailor(e.target.checked)} />
          Deep tailor (Opus 4.7)
        </label>
        {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" disabled={!valid || busy}>{busy ? "Tailoring…" : "Tailor"}</button>
        </div>
      </form>
    </div>
  );
}
