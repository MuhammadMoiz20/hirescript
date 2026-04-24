import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { api } from "../api";
import PdfPreview from "../components/PdfPreview";

export default function Editor({ id, onBack }: { id: number; onBack: () => void }) {
  const [latex, setLatex] = useState("");
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getResume(id).then(r => setLatex(r.latex_source));
  }, [id]);

  async function save() {
    setSaving(true);
    try { await api.updateResume(id, latex); } finally { setSaving(false); }
  }

  async function compile() {
    setError(null);
    try {
      await save();
      const blob = await api.compileResume(id);
      setPdf(blob as Blob);
    } catch (e: any) {
      setError(e?.detail?.log || String(e));
      setPdf(null);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100vh" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div>
          <button onClick={onBack}>← Back</button>
          <button onClick={save} disabled={saving}>Save</button>
          <button onClick={compile}>Compile</button>
        </div>
        <CodeMirror
          value={latex}
          extensions={[StreamLanguage.define(stex)]}
          onChange={setLatex}
          height="calc(100vh - 40px)"
        />
      </div>
      <div style={{ overflow: "auto", padding: 16 }}>
        {error ? <pre style={{ color: "crimson" }}>{error}</pre> : <PdfPreview pdfBlob={pdf} />}
      </div>
    </div>
  );
}
