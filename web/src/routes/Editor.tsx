import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { api, EditResult, ResumeOut, SectionsPayload } from "../api";
import PdfPreview from "../components/PdfPreview";
import ChatSidebar from "../components/ChatSidebar";
import DiffView from "../components/DiffView";
import SectionFormEditor from "../components/SectionFormEditor";
import VersionHistory from "../components/VersionHistory";

export default function Editor({ id, onBack }: { id: number; onBack: () => void }) {
  const [latex, setLatex] = useState("");
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [proposed, setProposed] = useState<EditResult | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [view, setView] = useState<"form" | "latex" | "history">("form");
  const [sectionsPayload, setSectionsPayload] = useState<SectionsPayload | null>(null);
  const [sectionsLoading, setSectionsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await api.getResume(id);
      setLatex(r.latex_source);
      try {
        const payload = await api.getSections(id);
        setSectionsPayload(payload);
      } catch {
        setView("latex");
      }
    })();
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

  async function switchTo(mode: "form" | "latex" | "history") {
    if (mode === view) return;
    if (mode === "form") {
      setSectionsLoading(true);
      try {
        await api.updateResume(id, latex);
        const payload = await api.getSections(id);
        setSectionsPayload(payload);
      } finally {
        setSectionsLoading(false);
      }
    }
    setView(mode);
  }

  function handleSaved(updated: ResumeOut) {
    setLatex(updated.latex_source);
    setPdf(null);
    compile();
    api.getSections(id).then(setSectionsPayload).catch(() => {});
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
          <button onClick={() => switchTo("form")} disabled={view === "form" || sectionsLoading}>Form</button>
          <button onClick={() => switchTo("latex")} disabled={view === "latex"}>LaTeX</button>
          <button onClick={() => switchTo("history")} disabled={view === "history"}>History</button>
        </div>
        {view === "history" ? (
          <VersionHistory
            resumeId={id}
            onRolledBack={(updated) => {
              setLatex(updated.latex_source);
              setPdf(null);
              compile();
              api.getSections(id).then(setSectionsPayload).catch(() => {});
            }}
          />
        ) : view === "latex" ? (
          <CodeMirror
            value={latex}
            extensions={[StreamLanguage.define(stex)]}
            onChange={setLatex}
            height="calc(100vh - 40px)"
          />
        ) : sectionsPayload ? (
          <SectionFormEditor resumeId={id} payload={sectionsPayload} onSaved={handleSaved} />
        ) : (
          <p>Loading sections…</p>
        )}
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
