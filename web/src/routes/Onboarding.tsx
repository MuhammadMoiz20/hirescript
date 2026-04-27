import { useState } from "react";
import { api, OnboardedResume, ResumeOut } from "../api";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import Input from "../components/ui/Input";
import Glyph, { GlyphName } from "../components/ui/Glyph";
import { useBreakpoint } from "../hooks/useBreakpoint";

type Mode = "scratch" | "tex" | "pdf";

interface Props {
  onCancel: () => void;
  onCreated: (resume: ResumeOut | OnboardedResume) => void;
}

interface PathCardProps {
  active: boolean;
  glyph: GlyphName;
  title: string;
  desc: string;
  hint: string;
  onClick: () => void;
}

/**
 * PathCard — the three-up source picker (scratch / paste LaTeX / upload PDF).
 * Mirrors the bundle's `PathCard` in screens-a.jsx::OnboardingScreen so the
 * library carve-out matches the suite visual language.
 */
function PathCard({ active, glyph, title, desc, hint, onClick }: PathCardProps) {
  return (
    <button
      type="button"
      data-testid={`onboarding-path-${glyph}`}
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
        padding: 18,
        textAlign: "left",
        border: active ? "1px solid var(--ink)" : "1px solid var(--rule)",
        background: active ? "var(--paper-2)" : "var(--paper)",
        borderRadius: 3,
        transition: "all 120ms",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 3,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--paper-2)",
          border: "1px solid var(--rule)",
        }}
      >
        <Glyph name={glyph} size={15} />
      </div>
      <div style={{ fontFamily: "var(--f-serif)", fontSize: 17, lineHeight: 1.1 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.4 }}>{desc}</div>
      <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: "auto" }}>
        {hint}
      </div>
    </button>
  );
}

/** Compact paper-card thumbnail of Jake's Resume (matches bundle). */
function TemplateThumbJakes() {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 3,
        background: "var(--paper)",
        padding: 12,
        width: 220,
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 8 }}>Template</div>
      <div
        style={{
          aspectRatio: "8.5 / 11",
          background: "var(--paper-2)",
          border: "1px solid var(--rule)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <svg viewBox="0 0 100 130" style={{ width: "100%", height: "100%", display: "block" }}>
          <rect width="100" height="130" fill="var(--paper)" />
          <text x="50" y="14" textAnchor="middle" fontFamily="serif" fontSize="7" fontWeight="700" fill="var(--ink)">YOUR NAME</text>
          <text x="50" y="19" textAnchor="middle" fontFamily="monospace" fontSize="3" fill="var(--ink-2)">you@example.com</text>
          <line x1="8" y1="24" x2="92" y2="24" stroke="var(--ink)" strokeWidth="0.4" />
          <text x="8" y="30" fontFamily="sans-serif" fontSize="4" fontWeight="600" fill="var(--ink)">EXPERIENCE</text>
          <line x1="8" y1="32" x2="92" y2="32" stroke="var(--ink)" strokeWidth="0.3" />
          {[36, 55, 72, 90, 106].map((y, i) => (
            <g key={i}>
              <rect x="8" y={y} width="40" height="1.4" fill="var(--ink-2)" />
              <rect x="78" y={y} width="14" height="1.4" fill="var(--ink-3)" />
              {[2, 5, 8].map((o) => (
                <rect key={o} x="10" y={y + 3 + o} width={o === 8 ? 55 : 80} height="0.9" fill="var(--ink-3)" />
              ))}
            </g>
          ))}
        </svg>
      </div>
      <div style={{ marginTop: 10, fontFamily: "var(--f-serif)", fontSize: 14 }}>Jake's Resume</div>
      <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>
        Dense · single-column · serif
      </div>
    </div>
  );
}

const MODE_HINT: Record<Mode, string> = {
  scratch: "Built-in template · compiles to one page out of the box.",
  tex: "We won't rewrite your source. We compile it as-is and report page count.",
  pdf: "We extract structure and reflow into LaTeX. You can edit afterwards.",
};

export default function Onboarding({ onCancel, onCreated }: Props) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [name, setName] = useState("");
  const [latex, setLatex] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorLog, setErrorLog] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const bp = useBreakpoint();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !mode || !name.trim()) return;
    setBusy(true);
    setError(null);
    setErrorLog(null);
    setWarn(null);
    try {
      let result: ResumeOut | OnboardedResume;
      if (mode === "scratch") {
        result = (await api.createResume(name.trim(), "jakes")) as ResumeOut;
      } else if (mode === "tex") {
        if (!latex.trim()) {
          setError("Paste your LaTeX source first.");
          return;
        }
        const r = await api.onboardTex(name.trim(), latex);
        if (!r.enforced) setWarn(`Imported, but compiles to ${r.page_count} pages — tighten in the editor.`);
        result = r;
      } else {
        if (!file) {
          setError("Choose a PDF file first.");
          return;
        }
        const r = await api.onboardPdf(name.trim(), file);
        if (!r.enforced) setWarn(`Imported, but compiles to ${r.page_count} pages — tighten in the editor.`);
        result = r;
      }
      setName("");
      setLatex("");
      setFile(null);
      onCreated(result);
    } catch (err: any) {
      const detail = err?.detail;
      if (detail?.error === "not_a_pdf") {
        setError("That doesn't look like a PDF.");
      } else if (detail?.error === "compile_failed") {
        setError("LaTeX failed to compile. See log below.");
        setErrorLog(typeof detail.log === "string" ? detail.log : null);
      } else {
        setError(err?.message || "Failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-component="onboarding-route"
      style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}
    >
      <main style={{ flex: 1, overflowY: "auto", padding: "28px 40px 80px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          {/* Breadcrumb / back row — matches suite Library header pattern. */}
          <div
            className="mono"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--ink-3)",
              marginBottom: 18,
            }}
          >
            <button
              type="button"
              onClick={onCancel}
              data-testid="onboarding-back"
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                color: "var(--ink-3)",
                cursor: "pointer",
                font: "inherit",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span aria-hidden="true" style={{ display: "inline-block", transform: "rotate(180deg)" }}>
                <Glyph name="arrow-r" size={11} />
              </span>
              Library
            </button>
            <span>/</span>
            <span style={{ color: "var(--ink-2)" }}>New resume</span>
          </div>

          {/* Page title block. */}
          <div style={{ marginBottom: 24 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Onboarding</div>
            <h1
              style={{
                fontFamily: "var(--f-serif)",
                fontSize: 30,
                letterSpacing: "-0.02em",
                margin: "0 0 8px",
                lineHeight: 1.1,
              }}
            >
              Start a new resume
            </h1>
            <p
              style={{
                color: "var(--ink-2)",
                fontSize: 13,
                margin: 0,
                maxWidth: 560,
                lineHeight: 1.5,
              }}
            >
              Pick a starting point. We compile every resume and report the page count —
              one page is the goal. You can edit and recompile anytime.
            </p>
          </div>

          {/* Source picker — three paper cards on the rule-paper background. */}
          <div className="eyebrow" style={{ marginBottom: 8 }}>1 · Pick a source</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            <PathCard
              active={mode === "scratch"}
              glyph="doc"
              title="Start from scratch"
              desc="Begin with the built-in Jake's Resume template."
              hint="fastest"
              onClick={() => setMode("scratch")}
            />
            <PathCard
              active={mode === "tex"}
              glyph="paste"
              title="Paste LaTeX"
              desc="Drop in an existing LaTeX source — we won't rewrite it."
              hint=".tex · any size"
              onClick={() => setMode("tex")}
            />
            <PathCard
              active={mode === "pdf"}
              glyph="upload"
              title="Upload PDF"
              desc="We'll extract structure and reflow into LaTeX."
              hint=".pdf · max 4 MB"
              onClick={() => setMode("pdf")}
            />
          </div>

          {mode && (
            <div
              style={{
                marginTop: 32,
                paddingTop: 28,
                borderTop: "1px solid var(--rule)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 14,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>2 · Details</div>
                  <h2
                    style={{
                      fontFamily: "var(--f-serif)",
                      fontSize: 20,
                      letterSpacing: "-0.01em",
                      margin: 0,
                    }}
                  >
                    {mode === "scratch"
                      ? "Name your master resume"
                      : mode === "tex"
                        ? "Paste your LaTeX"
                        : "Upload your PDF"}
                  </h2>
                </div>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", maxWidth: 360, textAlign: "right" }}>
                  {MODE_HINT[mode]}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: bp === "mobile" ? "minmax(0, 1fr)" : "minmax(0, 1fr) auto",
                  gap: 24,
                  alignItems: "flex-start",
                }}
              >
                {/* Paper card containing the form. */}
                <div
                  style={{
                    border: "1px solid var(--rule)",
                    borderRadius: 3,
                    background: "var(--paper)",
                    padding: 20,
                  }}
                >
                  <form
                    onSubmit={submit}
                    aria-label="New resume"
                    style={{ display: "flex", flexDirection: "column", gap: 14 }}
                  >
                    <Field label="Resume name">
                      <Input
                        aria-label="Resume name"
                        placeholder="e.g. Master 2026"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        style={{ fontFamily: "var(--f-mono)", fontSize: 13 }}
                      />
                    </Field>

                    {mode === "tex" && (
                      <Field label="Paste your LaTeX source">
                        <textarea
                          aria-label="LaTeX source"
                          value={latex}
                          onChange={(e) => setLatex(e.target.value)}
                          placeholder={"\\documentclass{article}\n\\begin{document}\n...\n\\end{document}"}
                          spellCheck={false}
                          style={{
                            width: "100%",
                            minHeight: 240,
                            border: "none",
                            outline: "none",
                            background: "transparent",
                            padding: "10px 12px",
                            fontFamily: "var(--f-mono)",
                            fontSize: 12.5,
                            lineHeight: 1.55,
                            color: "var(--ink)",
                            resize: "vertical",
                          }}
                        />
                      </Field>
                    )}

                    {mode === "pdf" && (
                      <Field label="PDF file">
                        <input
                          aria-label="PDF file"
                          type="file"
                          accept="application/pdf"
                          onChange={(e) => setFile(e.target.files?.[0] || null)}
                          style={{
                            padding: "8px 10px",
                            fontSize: 13,
                            color: "var(--ink)",
                            background: "transparent",
                            border: "none",
                            flex: 1,
                            fontFamily: "var(--f-mono)",
                          }}
                        />
                      </Field>
                    )}

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        paddingTop: 4,
                      }}
                    >
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={busy || !name.trim()}
                        iconRight={busy ? undefined : "arrow-r"}
                      >
                        {busy ? "Creating…" : "Create"}
                      </Button>
                      <Button type="button" variant="ghost" onClick={onCancel}>
                        Cancel
                      </Button>
                      <span style={{ flex: 1 }} />
                      {busy && (
                        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          compiling…
                        </span>
                      )}
                    </div>

                    {error && (
                      <div
                        role="alert"
                        style={{
                          border: "1px solid var(--err, crimson)",
                          background: "color-mix(in oklch, var(--err, crimson) 8%, var(--paper))",
                          color: "var(--ink)",
                          padding: "8px 12px",
                          borderRadius: 3,
                          fontSize: 13,
                          margin: 0,
                        }}
                      >
                        {error}
                      </div>
                    )}
                    {errorLog && (
                      <pre
                        data-testid="onboarding-error-log"
                        style={{
                          whiteSpace: "pre-wrap",
                          fontFamily: "var(--f-mono)",
                          fontSize: 11.5,
                          background: "var(--paper-2)",
                          border: "1px solid var(--rule)",
                          borderRadius: 3,
                          padding: 10,
                          margin: 0,
                          maxHeight: 220,
                          overflow: "auto",
                          color: "var(--ink-2)",
                        }}
                      >
                        {errorLog}
                      </pre>
                    )}
                    {warn && (
                      <div
                        role="status"
                        style={{
                          border: "1px solid var(--rule-strong)",
                          background: "var(--paper-2)",
                          color: "var(--ink)",
                          padding: "8px 12px",
                          borderRadius: 3,
                          fontSize: 13,
                          margin: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Glyph name="alert" size={13} />
                        <span>{warn}</span>
                      </div>
                    )}
                  </form>
                </div>

                {/* Side rail — template thumbnail (visible on non-mobile). */}
                {bp !== "mobile" && <TemplateThumbJakes />}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
