import { useState } from "react";
import { api, OnboardedResume, ResumeOut } from "../api";
import TopChrome from "../components/ui/TopChrome";
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

function PathCard({ active, glyph, title, desc, hint, onClick }: PathCardProps) {
  return (
    <button
      type="button"
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
          width: 28, height: 28, borderRadius: 3,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--paper-2)", border: "1px solid var(--rule)",
        }}
      >
        <Glyph name={glyph} size={15} />
      </div>
      <div style={{ fontFamily: "var(--f-serif)", fontSize: 17, lineHeight: 1.1 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.4 }}>{desc}</div>
      <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: "auto" }}>{hint}</div>
    </button>
  );
}

function TemplateThumbJakes() {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 3,
        background: "var(--paper)",
        padding: 12,
        width: 200,
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 8 }}>Template</div>
      <svg viewBox="0 0 100 130" style={{ width: "100%", height: "auto", display: "block" }}>
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
      <div style={{ marginTop: 8, fontFamily: "var(--f-serif)", fontSize: 13 }}>Jake's Resume</div>
      <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>
        Dense - single-column - serif
      </div>
    </div>
  );
}

export default function Onboarding({ onCancel, onCreated }: Props) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [name, setName] = useState("");
  const [latex, setLatex] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const bp = useBreakpoint();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !mode || !name.trim()) return;
    setBusy(true);
    setError(null);
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
      if (detail?.error === "not_a_pdf") setError("That doesn't look like a PDF.");
      else setError(err?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome>
        <button
          type="button"
          onClick={onCancel}
          style={{ background: "none", border: "none", color: "var(--ink-3)", cursor: "pointer", padding: 0, font: "inherit" }}
        >
          Library
        </button>
        <span> / </span>
        <span style={{ color: "var(--ink)" }}>New resume</span>
      </TopChrome>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "clamp(20px, 3vw, 32px) clamp(16px, 3vw, 24px) 80px" }}>
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
          <p style={{ color: "var(--ink-2)", fontSize: 14, marginBottom: 24, maxWidth: 540 }}>
            Pick a starting point. You can edit and recompile anytime.
          </p>

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
              hint=".tex - any size"
              onClick={() => setMode("tex")}
            />
            <PathCard
              active={mode === "pdf"}
              glyph="upload"
              title="Upload PDF"
              desc="We'll extract structure and reflow into LaTeX."
              hint=".pdf - max 4 MB"
              onClick={() => setMode("pdf")}
            />
          </div>

          {mode && (
            <div
              style={{
                marginTop: 28,
                display: "grid",
                gridTemplateColumns: bp === "mobile" ? "minmax(0, 1fr)" : "minmax(0, 1fr) auto",
                gap: 24,
                alignItems: "flex-start",
              }}
            >
              <form onSubmit={submit} aria-label="New resume" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label="Resume name">
                  <Input
                    aria-label="Resume name"
                    placeholder="e.g. Master 2026"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>

                {mode === "tex" && (
                  <Field label="Paste your LaTeX source">
                    <textarea
                      aria-label="LaTeX source"
                      value={latex}
                      onChange={(e) => setLatex(e.target.value)}
                      placeholder="\\documentclass{article}\n..."
                      style={{
                        width: "100%",
                        minHeight: 200,
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
                      style={{ padding: "8px 10px", fontSize: 13, color: "var(--ink)", background: "transparent", border: "none", flex: 1 }}
                    />
                  </Field>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
                    {busy ? "Creating…" : "Create"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={onCancel}>
                    Cancel
                  </Button>
                </div>

                {error && (
                  <p role="alert" style={{ color: "var(--err, crimson)", fontSize: 13, margin: 0 }}>
                    {error}
                  </p>
                )}
                {warn && (
                  <p role="status" style={{ color: "var(--warn, #a60)", fontSize: 13, margin: 0 }}>
                    {warn}
                  </p>
                )}
              </form>

              <TemplateThumbJakes />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
