import { useState } from "react";
import { api, OnboardedResume, ResumeOut } from "../api";

type Mode = "scratch" | "tex" | "pdf";

interface Props {
  onCreated: (resume: ResumeOut | OnboardedResume) => void;
}

export default function NewResumeMenu({ onCreated }: Props) {
  const [mode, setMode] = useState<Mode>("scratch");
  const [name, setName] = useState("");
  const [latex, setLatex] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError(null); setWarn(null);
    try {
      let result: ResumeOut | OnboardedResume;
      if (mode === "scratch") {
        result = (await api.createResume(name.trim(), "jakes")) as ResumeOut;
      } else if (mode === "tex") {
        if (!latex.trim()) { setError("Paste your LaTeX source first."); return; }
        const r = await api.onboardTex(name.trim(), latex);
        if (!r.enforced) setWarn(`Imported, but compiles to ${r.page_count} pages — tighten in the editor.`);
        result = r;
      } else {
        if (!file) { setError("Choose a PDF file first."); return; }
        const r = await api.onboardPdf(name.trim(), file);
        if (!r.enforced) setWarn(`Imported, but compiles to ${r.page_count} pages — tighten in the editor.`);
        result = r;
      }
      // Reset
      setName(""); setLatex(""); setFile(null);
      onCreated(result);
    } catch (e: any) {
      const detail = e?.detail;
      if (detail?.error === "not_a_pdf") setError("That doesn't look like a PDF.");
      else setError(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="New resume" style={{ marginBottom: 12, padding: 12, border: "1px solid #ddd", borderRadius: 6 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {(["scratch", "tex", "pdf"] as Mode[]).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)}
            style={{ fontWeight: mode === m ? 700 : 400 }}>
            {m === "scratch" ? "From scratch" : m === "tex" ? "Paste LaTeX" : "From PDF"}
          </button>
        ))}
      </div>
      <input aria-label="Resume name" placeholder="Resume name" value={name} onChange={e => setName(e.target.value)} />
      {mode === "tex" && (
        <textarea aria-label="LaTeX source" placeholder="Paste full LaTeX document"
          value={latex} onChange={e => setLatex(e.target.value)} rows={8} style={{ width: "100%", marginTop: 8 }} />
      )}
      {mode === "pdf" && (
        <input aria-label="PDF file" type="file" accept="application/pdf"
          onChange={e => setFile(e.target.files?.[0] || null)} style={{ marginTop: 8 }} />
      )}
      <div style={{ marginTop: 8 }}>
        <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
      </div>
      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
      {warn && <p role="status" style={{ color: "#a60" }}>{warn}</p>}
    </form>
  );
}
