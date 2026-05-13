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
import EditorLeftRail, { EditorView } from "../components/editor/EditorLeftRail";
import EditorToolbar from "../components/editor/EditorToolbar";
import ChatDrawer from "../components/editor/ChatDrawer";
import MobileTabBar, { MobileTab } from "../components/editor/MobileTabBar";
import Glyph from "../components/ui/Glyph";
import PageCountBadge from "../components/ui/PageCountBadge";
import Button from "../components/ui/Button";
import { githubLight, githubDark } from "@uiw/codemirror-theme-github";
import { useTheme } from "../components/ThemeProvider";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { downloadFilename } from "../util/downloadFilename";

export default function Editor({
  id,
  onBack,
  onOpenResume,
}: {
  id: number;
  onBack: () => void;
  onOpenResume?: (id: number) => void;
}) {
  const [resumeName, setResumeName] = useState<string>("");
  const [resumeKind, setResumeKind] = useState<string>("master");
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
  const [overflowCount, setOverflowCount] = useState<number>(0);
  const [tightening, setTightening] = useState(false);
  const [enforcingOneLine, setEnforcingOneLine] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [formContent, setFormContent] = useState<any>(null);
  const { theme } = useTheme();
  const cmTheme = theme === "dark" ? githubDark : githubLight;
  const bp = useBreakpoint();
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("edit");
  // Desktop chat rail starts collapsed (36px strip) so the editor + PDF
  // preview get the full width — the open state was crowding the layout into
  // four narrow columns. Users can expand it on demand from the side strip.
  const [desktopChatOpen, setDesktopChatOpen] = useState(false);
  const [compiledAt, setCompiledAt] = useState<number | null>(null);

  // The form editor holds the user's in-progress content_json. The preview's
  // pageCount reflects the *last saved* latex_source, not the current form
  // state — so if the user edited the form without recompiling, pageCount=1
  // can be a lie. Treat the preview as stale until a save+compile catches up.
  const formDirty =
    view === "form" &&
    formContent != null &&
    sectionsPayload != null &&
    JSON.stringify(formContent) !== JSON.stringify(sectionsPayload.content_json);

  useEffect(() => {
    (async () => {
      const r = await api.getResume(id);
      setLatex(r.latex_source);
      setResumeName(r.name);
      setResumeKind(r.kind || "master");
      try {
        const payload = await api.getSections(id);
        setSectionsPayload(payload);
      } catch {
        setView("latex");
      }
      // Auto-compile on open so the preview is ready without a manual click.
      setCompiling(true);
      try {
        const { pdf: blob, pageCount: pc, overflowCount: oc } = await api.compileResume(id);
        setPdf(blob);
        setPageCount(pc);
        setOverflowCount(oc);
        setCompiledAt(Date.now());
      } catch (e: any) {
        const detail = e?.detail ?? e;
        setError(detail?.log || detail?.message || String(e));
      } finally {
        setCompiling(false);
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
    setError(null);
    try {
      if (view === "form" && formContent) {
        // Form view: render form → LaTeX → compile → persist via /sections.
        const updated = await api.putSections(id, formContent);
        setLatex(updated.latex_source);
        // Refresh sections in case the renderer normalized something.
        api.getSections(id).then(setSectionsPayload).catch(() => {});
      } else {
        await api.updateResume(id, latex);
      }
    } catch (e: any) {
      const detail = e?.detail ?? e;
      if (detail?.error === "not_one_page") {
        setError(`Renders to ${detail.page_count} pages — tighten and try again.`);
        // Reflect the rejected page count so the OverflowBanner appears with
        // the "Ask Claude to tighten" CTA — otherwise the user has no escape
        // path while save is blocked.
        if (typeof detail.page_count === "number") setPageCount(detail.page_count);
      } else if (detail?.error === "compile_failed") {
        setError(detail.log || "Compile failed.");
      } else {
        setError(detail?.message || String(e));
      }
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function compile() {
    setError(null);
    setCompiling(true);
    let saveOk = false;
    try {
      await save();
      saveOk = true;
      const { pdf: blob, pageCount: pc, overflowCount: oc } = await api.compileResume(id);
      setPdf(blob);
      setPageCount(pc);
      setOverflowCount(oc);
      setCompiledAt(Date.now());
    } catch (e: any) {
      // If save() threw it already set a user-facing error; don't clobber it
      // with a serialized exception. Only handle the compileResume case here.
      if (saveOk) {
        const detail = e?.detail ?? e;
        setError(detail?.log || detail?.message || String(e));
      }
      // Keep the previously-rendered PDF visible — wiping it on error left
      // the user with no preview and caused the preview pane to flash between
      // the PDF and the error block on every retry.
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

  async function download() {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      // Compile fresh so the downloaded PDF reflects the current saved state
      // (compile() also persists). If we already have a recent blob, reuse it
      // to avoid an unnecessary round-trip.
      let blob = pdf;
      if (!blob) {
        await save();
        const compiled = await api.compileResume(id);
        blob = compiled.pdf;
        setPdf(blob);
        setPageCount(compiled.pageCount);
        setOverflowCount(compiled.overflowCount);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadFilename(resumeName);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      const detail = e?.detail ?? e;
      setError(detail?.log || detail?.message || String(e));
    } finally {
      setDownloading(false);
    }
  }

  async function tighten() {
    if (tightening) return;
    setTightening(true);
    setError(null);
    try {
      // Persist current latex first so the enforcer operates on the same
      // source the user sees in the editor.
      try { await api.updateResume(id, latex); } catch { /* surface via repair if it fails */ }
      const result = await api.repairResume(id);
      setProposed({
        proposed_latex: result.latex_source,
        page_count: result.page_count,
        enforced: result.enforced,
        iterations: result.iterations,
        tier_history: result.tier_history,
        removed_terms: [],
        kind: "edit",
      });
      if (!result.enforced && result.overflow_count === 0 && result.page_count > 1) {
        setError(`Couldn't reach 1 page after ${result.iterations} attempts.`);
      }
    } catch (e: any) {
      const detail = e?.detail ?? e;
      setError(detail?.log || detail?.message || String(e));
    } finally {
      setTightening(false);
    }
  }

  async function enforceOneLine() {
    if (enforcingOneLine) return;
    const ok = window.confirm(
      "This will create a new resume with one-line-per-bullet enforced. Continue?",
    );
    if (!ok) return;
    setEnforcingOneLine(true);
    setError(null);
    try {
      try { await api.updateResume(id, latex); } catch { /* surface below if it fails */ }
      const sibling = await api.enforceOneLine(id);
      if (onOpenResume) {
        onOpenResume(sibling.id);
      } else {
        onBack();
      }
    } catch (e: any) {
      const detail = e?.detail ?? e;
      setError(detail?.log || detail?.message || String(e));
    } finally {
      setEnforcingOneLine(false);
    }
  }

  const centerView = view === "history" ? (
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
      theme={cmTheme}
      onChange={setLatex}
      height="100%"
      style={{ height: "100%" }}
    />
  ) : sectionsPayload ? (
    <SectionFormEditor
      resumeId={id}
      payload={sectionsPayload}
      onSaved={handleSaved}
      onContentChange={setFormContent}
    />
  ) : (
    <p style={{ padding: 16, color: "var(--ink-3)", fontSize: 13 }}>Loading sections…</p>
  );

  const errorBanner = error ? (
    <pre
      style={{
        color: "var(--err)",
        background: "var(--err-soft)",
        border: "1px solid color-mix(in oklch, var(--err) 30%, transparent)",
        padding: 10,
        borderRadius: 3,
        fontSize: 12,
        whiteSpace: "pre-wrap",
        margin: "0 0 10px",
        flexShrink: 0,
      }}
    >
      {error}
    </pre>
  ) : null;

  const previewPane = proposed ? (
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
  ) : (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {errorBanner}
      <div style={{ flex: 1, minHeight: 0 }}>
        <PdfPreview pdfBlob={pdf} />
      </div>
    </div>
  );

  if (bp === "mobile") {
    return (
      <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
        <EditorToolbar
          resumeName={resumeName}
          onBack={onBack}
          onSave={save}
          onCompile={compile}
          onDownload={download}
          saving={saving}
          compiling={compiling}
          downloading={downloading}
          pageCount={pageCount}
        />
        <OverflowBanner pageCount={pageCount} overflowCount={overflowCount} onTighten={tighten} busy={tightening} />
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {mobileTab === "edit" && (
            <>
              <div style={{ display: "flex", borderBottom: "1px solid var(--rule)", background: "var(--paper)" }}>
                {(["form", "latex"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => switchTo(v)}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      fontSize: 12,
                      fontFamily: "var(--f-mono)",
                      color: view === v ? "var(--ink)" : "var(--ink-3)",
                      border: "none",
                      borderBottom: view === v ? "2px solid var(--ink)" : "2px solid transparent",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    {v === "form" ? "Form" : "LaTeX"}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                {view === "latex" ? (
                  <CodeMirror
                    value={latex}
                    extensions={[StreamLanguage.define(stex)]}
                    theme={cmTheme}
                    onChange={setLatex}
                    height="100%"
                    style={{ height: "100%" }}
                  />
                ) : sectionsPayload ? (
                  <SectionFormEditor
                    resumeId={id}
                    payload={sectionsPayload}
                    onSaved={handleSaved}
                    onContentChange={setFormContent}
                  />
                ) : (
                  <p style={{ padding: 16, color: "var(--ink-3)", fontSize: 13 }}>Loading sections…</p>
                )}
              </div>
            </>
          )}
          {mobileTab === "preview" && (
            <div style={{ padding: 16, overflow: "auto", flex: 1, background: "var(--paper-2)" }}>
              {previewPane}
            </div>
          )}
          {mobileTab === "chat" && (
            <ChatSidebar
              resumeId={id}
              getCurrentLatex={() => latex}
              onProposed={(r) => {
                if (r.proposed_latex) setProposed(r);
              }}
            />
          )}
          {mobileTab === "history" && (
            <VersionHistory
              resumeId={id}
              onRolledBack={(updated) => {
                setLatex(updated.latex_source);
                setPdf(null);
                compile();
                api.getSections(id).then(setSectionsPayload).catch(() => {});
              }}
            />
          )}
        </div>
        <MobileTabBar value={mobileTab} onChange={setMobileTab} />
      </div>
    );
  }

  const isDesktop = bp === "desktop";

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <OverflowBanner pageCount={pageCount} overflowCount={overflowCount} onTighten={tighten} busy={tightening} />
      <div
        style={{
          flex: 1,
          display: "grid",
          // Bundle (`screens-a.jsx::EditorScreen`) layout: left rail + form
          // editor + PDF hero + 360px chat rail. The chat rail collapses to a
          // 36px vertical strip when the user wants more PDF width.
          gridTemplateColumns: isDesktop
            ? `48px minmax(360px, 1fr) minmax(440px, 1.1fr) ${desktopChatOpen ? "360px" : "36px"}`
            : "48px minmax(320px, 0.95fr) minmax(440px, 1.05fr)",
          gridTemplateRows: "minmax(0, 1fr)",
          minHeight: 0,
        }}
      >
        <EditorLeftRail view={view} onChange={switchTo} disabled={sectionsLoading} />

        {/* Center: toolbar + active editor panel */}
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
            onDownload={download}
            saving={saving}
            compiling={compiling}
            downloading={downloading}
            pageCount={pageCount}
            onOpenChat={!isDesktop ? () => setChatOpen(true) : undefined}
          />
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {centerView}
          </div>
        </div>

        {/* PDF preview hero — bundle's 420-ish column with chip header */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: "var(--paper-2)",
            borderRight: isDesktop && desktopChatOpen ? "1px solid var(--rule)" : "1px solid var(--rule)",
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid var(--rule)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--paper)",
              flexShrink: 0,
            }}
          >
            <PageCountBadge state={compiling ? "compiling" : pageCount} size="sm" />
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-3)" }}
              data-testid="pdf-meta"
            >
              {compiling
                ? "compiling…"
                : formDirty
                  ? "preview stale — recompile"
                  : compiledAt
                    ? "compiled just now"
                    : "not yet compiled"}
            </span>
            <span style={{ flex: 1 }} />
            <Button
              size="sm"
              variant="ghost"
              icon="download"
              onClick={download}
              disabled={downloading || !pdf}
              aria-label="Download PDF"
              title="Download PDF"
            >
              PDF
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={enforceOneLine}
              disabled={enforcingOneLine}
              title="Create a new resume with one-line-per-bullet enforced"
            >
              {enforcingOneLine ? "Enforcing…" : "Enforce one-line per bullet → save as new"}
            </Button>
            <Button
              size="sm"
              variant={(pageCount === 1 || resumeKind === "master") && !formDirty ? "primary" : "default"}
              disabled={saving || formDirty || (resumeKind !== "master" && pageCount !== 1)}
              onClick={save}
              title={
                formDirty
                  ? "Compile first — the preview doesn't reflect your latest edits"
                  : resumeKind === "master"
                    ? "Save"
                    : pageCount === 1
                      ? "Save as final"
                      : `Can't save as final — ${pageCount} pages`
              }
            >
              {resumeKind === "master" ? "Save" : "Save as final"}
            </Button>
          </div>
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: 16,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {previewPane}
          </div>
        </div>

        {/* Chat rail (desktop only) — collapsible */}
        {isDesktop && desktopChatOpen && (
          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              background: "var(--paper)",
            }}
          >
            <ChatSidebar
              resumeId={id}
              getCurrentLatex={() => latex}
              onProposed={(result) => {
                if (result.proposed_latex) setProposed(result);
              }}
              onClose={() => setDesktopChatOpen(false)}
            />
          </div>
        )}
        {isDesktop && !desktopChatOpen && (
          <button
            type="button"
            onClick={() => setDesktopChatOpen(true)}
            title="Open Claude"
            aria-label="Open chat"
            style={{
              borderLeft: "1px solid var(--rule)",
              background: "var(--paper)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "14px 0",
              gap: 8,
              color: "var(--ink-2)",
              cursor: "pointer",
            }}
          >
            <Glyph name="chat" size={14} />
            <span
              className="mono"
              style={{
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                fontSize: 11,
              }}
            >
              Claude
            </span>
          </button>
        )}
      </div>

      {!isDesktop && (
        <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)}>
          <ChatSidebar
            resumeId={id}
            getCurrentLatex={() => latex}
            onProposed={(r) => {
              if (r.proposed_latex) setProposed(r);
              setChatOpen(false);
            }}
          />
        </ChatDrawer>
      )}
    </div>
  );
}
