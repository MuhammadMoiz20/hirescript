import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { api, EditResult } from "../api";
import PdfPreview from "../components/PdfPreview";
import ChatSidebar from "../components/ChatSidebar";
import DiffView from "../components/DiffView";

export default function Editor({ id, onBack }: { id: number; onBack: () => void }) {
  const [latex, setLatex] = useState("");
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [proposed, setProposed] = useState<EditResult | null>(null);
  const [accepting, setAccepting] = useState(false);

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

  async function handleAccept() {
    if (!proposed) return;
    setAccepting(true);
    try {
      const updated = await api.acceptEdit(id, proposed.proposed_latex);
      setLatex(updated.latex_source);
      setProposed(null);
      setPdf(null);
      // recompile to update preview
      await compile();
    } catch (e: any) {
      setError(e?.detail?.log || e?.message || String(e));
    } finally {
      setAccepting(false);
    }
  }

  function handleReject() {
    setProposed(null);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 360px", height: "100vh" }}>
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
      <div style={{ overflow: "auto", padding: 16, borderLeft: "1px solid #eee" }}>
        {proposed ? (
          <DiffView
            currentLatex={latex}
            proposedLatex={proposed.proposed_latex}
            pageCount={proposed.page_count}
            enforced={proposed.enforced}
            removedTerms={proposed.removed_terms}
            onAccept={handleAccept}
            onReject={handleReject}
            busy={accepting}
          />
        ) : error ? (
          <pre style={{ color: "crimson" }}>{error}</pre>
        ) : (
          <PdfPreview pdfBlob={pdf} />
        )}
      </div>
      <div style={{ borderLeft: "1px solid #eee", overflow: "hidden" }}>
        <ChatSidebar resumeId={id} onProposed={setProposed} />
      </div>
    </div>
  );
}
