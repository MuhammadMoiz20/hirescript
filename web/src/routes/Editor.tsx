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
import OverflowBanner from "../components/OverflowBanner";
import TopChrome from "../components/ui/TopChrome";
import EditorLeftRail, { EditorView } from "../components/editor/EditorLeftRail";
import EditorToolbar from "../components/editor/EditorToolbar";

export default function Editor({ id, onBack }: { id: number; onBack: () => void }) {
  const [resumeName, setResumeName] = useState<string>("");
  const [latex, setLatex] = useState("");
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [proposed, setProposed] = useState<EditResult | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [view, setView] = useState<EditorView>("form");
  const [sectionsPayload, setSectionsPayload] = useState<SectionsPayload | null>(null);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [pageCount, setPageCount] = useState<number>(1);
  const [tightening, setTightening] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await api.getResume(id);
      setLatex(r.latex_source);
      setResumeName(r.name);
      try {
        const payload = await api.getSections(id);
        setSectionsPayload(payload);
      } catch {
        setView("latex");
      }
    })();
  }, [id]);

  // Reflect overflow state on body for global styling hooks.
  useEffect(() => {
    document.body.dataset.overflow = pageCount > 1 ? "true" : "false";
    return () => {
      document.body.dataset.overflow = "false";
    };
  }, [pageCount]);

  async function save() {
    setSaving(true);
    try {
      await api.updateResume(id, latex);
    } finally {
      setSaving(false);
    }
  }

  async function compile() {
    setError(null);
    setCompiling(true);
    try {
      await save();
      const { pdf: blob, pageCount: pc } = await api.compileResume(id);
      setPdf(blob);
      setPageCount(pc);
    } catch (e: any) {
      setError(e?.detail?.log || String(e));
      setPdf(null);
    } finally {
      setCompiling(false);
    }
  }

  async function switchTo(mode: EditorView) {
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

  async function tighten() {
    if (tightening) return;
    setTightening(true);
    try {
      await api.streamEdit(
        id,
        "Tighten this resume so it fits on exactly one page. Do not drop protected terms.",
        "haiku",
        {
          onResult: (result) => setProposed(result),
          onError: (msg) => setError(msg),
        },
      );
    } finally {
      setTightening(false);
    }
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome>
        <span>Library</span>
        <span style={{ color: "var(--rule-strong)" }}>/</span>
        <strong style={{ color: "var(--ink)", fontWeight: 600 }}>{resumeName || "—"}</strong>
      </TopChrome>

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "48px 1fr 1fr 360px",
          minHeight: 0,
        }}
      >
        <EditorLeftRail view={view} onChange={switchTo} disabled={sectionsLoading} />

        {/* Center: toolbar + overflow + active panel */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            borderRight: "1px solid var(--rule)",
            background: "var(--paper-2)",
          }}
        >
          <EditorToolbar
            resumeName={resumeName}
            onBack={onBack}
            onSave={save}
            onCompile={compile}
            saving={saving}
            compiling={compiling}
            pageCount={pageCount}
          />
          <OverflowBanner pageCount={pageCount} onTighten={tighten} busy={tightening} />
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
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
                height="100%"
                style={{ height: "100%" }}
              />
            ) : sectionsPayload ? (
              <SectionFormEditor resumeId={id} payload={sectionsPayload} onSaved={handleSaved} />
            ) : (
              <p style={{ padding: 16, color: "var(--ink-3)", fontSize: 13 }}>Loading sections…</p>
            )}
          </div>
        </div>

        {/* Preview / Diff */}
        <div
          style={{
            overflow: "auto",
            padding: 16,
            borderRight: "1px solid var(--rule)",
            background: "var(--paper-2)",
            minWidth: 0,
          }}
        >
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
            <pre
              style={{
                color: "var(--err)",
                background: "var(--err-soft)",
                border: "1px solid color-mix(in oklch, var(--err) 30%, transparent)",
                padding: 10,
                borderRadius: 3,
                fontSize: 12,
                whiteSpace: "pre-wrap",
              }}
            >
              {error}
            </pre>
          ) : (
            <PdfPreview pdfBlob={pdf} />
          )}
        </div>

        {/* Chat rail */}
        <div style={{ minWidth: 0, overflow: "hidden" }}>
          <ChatSidebar resumeId={id} onProposed={setProposed} />
        </div>
      </div>
    </div>
  );
}
