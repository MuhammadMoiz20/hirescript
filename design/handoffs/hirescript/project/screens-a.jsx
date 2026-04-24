// HireScript — screens 1-5

const { useState: useStateA, useEffect: useEffectA, useRef: useRefA, useMemo: useMemoA } = React;

// ============================================================
// 1. LOGIN
// ============================================================
function LoginScreen() {
  const [pw, setPw] = useStateA("");
  const [shake, setShake] = useStateA(false);
  const submit = (e) => {
    e.preventDefault();
    if (pw.length < 3) { setShake(true); setTimeout(() => setShake(false), 400); return; }
    location.hash = "#/library";
  };
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper)" }}>
      <form onSubmit={submit} style={{
        width: 340, display: "flex", flexDirection: "column", gap: 18,
        animation: shake ? "none" : "none",
        transform: shake ? "translateX(0)" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Wordmark />
        </div>
        <div>
          <div style={{ fontFamily: "var(--f-serif)", fontSize: 26, letterSpacing: "-0.015em", lineHeight: 1.1 }}>
            One resume, tailored endlessly.
          </div>
          <div style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 6, fontFamily: "var(--f-mono)" }}>
            LaTeX in, one-page PDFs out.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          <Field label="Password">
            <Input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••" style={{ fontFamily: "var(--f-mono)", letterSpacing: "0.1em" }} />
          </Field>
          <Button type="submit" variant="primary" onClick={submit} style={{ justifyContent: "center", padding: "9px 12px" }}>
            Unlock
          </Button>
        </div>
        <div style={{ color: "var(--ink-3)", fontSize: 12, display: "flex", justifyContent: "space-between", fontFamily: "var(--f-mono)" }}>
          <span>single-tenant · self-hosted</span>
          <a href="#/onboarding" style={{ color: "var(--ink-2)", textDecoration: "underline" }}>first run →</a>
        </div>
      </form>
    </div>
  );
}

// ============================================================
// 2. ONBOARDING
// ============================================================
function OnboardingScreen() {
  const [source, setSource] = useStateA(null); // 'pdf' | 'tex' | 'paste'
  const [content, setContent] = useStateA("");
  const [filename, setFilename] = useStateA("");
  const [tmpl, setTmpl] = useStateA(null);

  const hasContent = (source === "paste" && content.trim().length > 30) || (source !== "paste" && source && filename);

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--paper)" }}>
      <TopChrome current="Onboarding" onCmdK={() => {}} />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 32px 80px" }}>
        <div className="eyebrow">Step {source ? (tmpl ? 3 : 2) : 1} of 3</div>
        <h1 style={{ fontFamily: "var(--f-serif)", fontSize: 34, letterSpacing: "-0.02em", margin: "6px 0 8px", lineHeight: 1.1 }}>
          Bring your resume in.
        </h1>
        <p style={{ color: "var(--ink-2)", fontSize: 14, marginBottom: 32, maxWidth: 540 }}>
          HireScript works off a single master resume. Start from an existing file, paste LaTeX you already have, or let us OCR a PDF. You can change templates later.
        </p>

        {/* Three-path chooser */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <PathCard
            active={source === "pdf"}
            glyph="upload"
            title="Upload PDF"
            desc="We'll OCR, extract structure, and reflow into LaTeX."
            hint=".pdf · max 4 MB"
            onClick={() => { setSource("pdf"); setFilename("maya-okafor-2023.pdf"); }}
          />
          <PathCard
            active={source === "tex"}
            glyph="doc"
            title="Upload .tex"
            desc="Drop in your existing LaTeX source — we won't rewrite it."
            hint=".tex · max 500 KB"
            onClick={() => { setSource("tex"); setFilename("resume.tex"); }}
          />
          <PathCard
            active={source === "paste"}
            glyph="paste"
            title="Paste LaTeX"
            desc="Paste a \\begin{document} block straight in."
            hint="any size"
            onClick={() => setSource("paste")}
          />
        </div>

        {/* What comes next — conditional panels */}
        {source === "paste" && (
          <div style={{ marginTop: 20 }}>
            <Field label="Paste your LaTeX source">
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="\\documentclass{article}\n..."
                style={{
                  width: "100%", minHeight: 200, border: "none", outline: "none",
                  background: "transparent", padding: "12px 14px",
                  fontFamily: "var(--f-mono)", fontSize: 12.5, lineHeight: 1.55,
                  color: "var(--ink)", resize: "vertical",
                }}
              />
            </Field>
          </div>
        )}
        {source && source !== "paste" && (
          <div style={{ marginTop: 18, padding: "12px 14px", border: "1px solid var(--rule)", borderRadius: 3, display: "flex", alignItems: "center", gap: 10, background: "var(--paper-2)" }}>
            <Glyph name={source === "pdf" ? "doc" : "doc"} size={16} />
            <span className="mono" style={{ fontSize: 13 }}>{filename}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>· 86 KB</span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 11, color: "var(--ok)", display: "flex", alignItems: "center", gap: 5 }}>
              <Glyph name="check" size={12} /> ready
            </span>
            <button onClick={() => { setSource(null); setFilename(""); }} style={{ color: "var(--ink-3)" }}>
              <Glyph name="cross" size={13} />
            </button>
          </div>
        )}

        {/* Template picker — reveals after content */}
        {hasContent && (
          <div style={{ marginTop: 40, paddingTop: 32, borderTop: "1px solid var(--rule)" }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Pick a template</div>
            <h2 style={{ fontFamily: "var(--f-serif)", fontSize: 22, letterSpacing: "-0.01em", margin: "0 0 6px" }}>
              How should your master render?
            </h2>
            <p style={{ color: "var(--ink-2)", fontSize: 13, marginBottom: 18, maxWidth: 520 }}>
              Claude will map your content into the template you pick. You can switch later without losing content.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              {[
                { id: "jakes", name: "Jake's Resume", meta: "Dense · single-column · serif", thumb: <TemplateThumbJakes /> },
                { id: "awesome", name: "Awesome-CV", meta: "Two-column · header rule · sans", thumb: <TemplateThumbAwesome /> },
                { id: "rendercv", name: "RenderCV", meta: "Airy · sidebar dates · serif", thumb: <TemplateThumbRenderCV /> },
              ].map(t => (
                <button key={t.id} onClick={() => setTmpl(t.id)} style={{
                  textAlign: "left",
                  border: tmpl === t.id ? "2px solid var(--ink)" : "1px solid var(--rule)",
                  padding: 1,
                  background: "var(--paper)",
                  borderRadius: 3,
                }}>
                  <div style={{ aspectRatio: "8.5 / 11", background: "var(--paper-2)", borderBottom: "1px solid var(--rule)", position: "relative", overflow: "hidden" }}>
                    {t.thumb}
                    {tmpl === t.id && (
                      <span style={{ position: "absolute", top: 8, right: 8, width: 20, height: 20, borderRadius: "50%", background: "var(--ink)", color: "var(--paper)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Glyph name="check" size={12} stroke={2.5} />
                      </span>
                    )}
                  </div>
                  <div style={{ padding: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>{t.meta}</div>
                  </div>
                </button>
              ))}
            </div>

            <div style={{ marginTop: 28, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Button variant="ghost" onClick={() => { setSource(null); setTmpl(null); setContent(""); setFilename(""); }}>Start over</Button>
              <Button variant="primary" disabled={!tmpl} onClick={() => { location.hash = "#/library"; }} iconRight="arrow-r">
                Map my content into this template
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
function PathCard({ active, glyph, title, desc, hint, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8,
      padding: 18, textAlign: "left",
      border: active ? "1px solid var(--ink)" : "1px solid var(--rule)",
      background: active ? "var(--paper-2)" : "var(--paper)",
      borderRadius: 3,
      transition: "all 120ms",
    }}>
      <div style={{ width: 28, height: 28, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper-2)", border: "1px solid var(--rule)" }}>
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
    <svg viewBox="0 0 100 130" style={{ width: "100%", height: "100%", display: "block" }}>
      <rect width="100" height="130" fill="var(--paper)" />
      <text x="50" y="14" textAnchor="middle" fontFamily="serif" fontSize="7" fontWeight="700" fill="var(--ink)">MAYA OKAFOR</text>
      <text x="50" y="19" textAnchor="middle" fontFamily="monospace" fontSize="3" fill="var(--ink-2)">maya@okafor.dev · github.com/maya-ok</text>
      <line x1="8" y1="24" x2="92" y2="24" stroke="var(--ink)" strokeWidth="0.4" />
      <text x="8" y="30" fontFamily="sans-serif" fontSize="4" fontWeight="600" fill="var(--ink)">EXPERIENCE</text>
      <line x1="8" y1="32" x2="92" y2="32" stroke="var(--ink)" strokeWidth="0.3" />
      {[36, 55, 72, 90, 106].map((y, i) => (
        <g key={i}>
          <rect x="8" y={y} width="40" height="1.4" fill="var(--ink-2)" />
          <rect x="78" y={y} width="14" height="1.4" fill="var(--ink-3)" />
          {[2, 5, 8].map((o) => <rect key={o} x="10" y={y + 3 + o} width={o === 8 ? 55 : 80} height="0.9" fill="var(--ink-3)" />)}
        </g>
      ))}
    </svg>
  );
}
function TemplateThumbAwesome() {
  return (
    <svg viewBox="0 0 100 130" style={{ width: "100%", height: "100%", display: "block" }}>
      <rect width="100" height="130" fill="var(--paper)" />
      <rect x="0" y="0" width="100" height="22" fill="var(--ink)" />
      <text x="50" y="12" textAnchor="middle" fontFamily="sans-serif" fontSize="8" fontWeight="300" fill="var(--paper)">MAYA OKAFOR</text>
      <text x="50" y="18" textAnchor="middle" fontFamily="sans-serif" fontSize="3" fill="var(--paper)" opacity="0.7">SOFTWARE ENGINEER</text>
      <text x="32" y="30" textAnchor="middle" fontFamily="sans-serif" fontSize="4" fontWeight="600" fill="var(--ink)">EXPERIENCE</text>
      <line x1="8" y1="32" x2="56" y2="32" stroke="var(--ink)" strokeWidth="0.3" />
      {[38, 54, 70, 88].map((y, i) => (
        <g key={i}>
          <rect x="8" y={y} width="30" height="1.3" fill="var(--ink-2)" />
          {[2, 4, 6].map((o) => <rect key={o} x="8" y={y + 3 + o} width={o === 6 ? 35 : 48} height="0.8" fill="var(--ink-3)" />)}
        </g>
      ))}
      <text x="80" y="30" textAnchor="middle" fontFamily="sans-serif" fontSize="4" fontWeight="600" fill="var(--ink)">SKILLS</text>
      <line x1="62" y1="32" x2="92" y2="32" stroke="var(--ink)" strokeWidth="0.3" />
      {[38, 46, 54, 62, 70, 78].map((y, i) => <rect key={i} x="62" y={y} width={18 + (i % 3) * 8} height="0.9" fill="var(--ink-3)" />)}
    </svg>
  );
}
function TemplateThumbRenderCV() {
  return (
    <svg viewBox="0 0 100 130" style={{ width: "100%", height: "100%", display: "block" }}>
      <rect width="100" height="130" fill="var(--paper)" />
      <text x="50" y="16" textAnchor="middle" fontFamily="serif" fontSize="9" fontWeight="500" fill="var(--ink)">Maya Okafor</text>
      <text x="50" y="22" textAnchor="middle" fontFamily="serif" fontSize="3" fontStyle="italic" fill="var(--ink-2)">maya@okafor.dev · +1 646 555 0139</text>
      <text x="8" y="36" fontFamily="serif" fontSize="5" fontStyle="italic" fill="var(--ink)">Experience</text>
      {[44, 64, 82, 100].map((y, i) => (
        <g key={i}>
          <text x="8" y={y + 1} fontFamily="monospace" fontSize="2.5" fill="var(--ink-3)">2022—now</text>
          <rect x="28" y={y - 1} width="28" height="1.4" fill="var(--ink-2)" />
          {[2, 5].map((o) => <rect key={o} x="28" y={y + 2 + o} width={o === 5 ? 48 : 64} height="0.8" fill="var(--ink-3)" />)}
        </g>
      ))}
    </svg>
  );
}

// ============================================================
// 3. RESUME LIBRARY (DASHBOARD)
// ============================================================
function LibraryScreen() {
  const { master, variants } = window.FIXTURES;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome current="Library" onCmdK={window.__openCmd} autosave="2s ago" />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <NavRail current="library" />
        <main style={{ flex: 1, overflowY: "auto", padding: "28px 40px 60px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Your resumes</div>
              <h1 style={{ fontFamily: "var(--f-serif)", fontSize: 30, letterSpacing: "-0.02em", margin: 0 }}>Library</h1>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button icon="sparkle" variant="primary" onClick={() => location.hash = "#/tailor"}>Tailor to a JD</Button>
            </div>
          </div>

          {/* Master card — large, pinned */}
          <MasterCard master={master} />

          {/* Variants */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "36px 0 12px" }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Variants · tied to master</div>
              <h2 style={{ fontFamily: "var(--f-serif)", fontSize: 20, letterSpacing: "-0.01em", margin: 0 }}>Job-tailored versions</h2>
            </div>
            <span className="mono" style={{ color: "var(--ink-3)", fontSize: 11 }}>
              {variants.length} variant{variants.length === 1 ? "" : "s"}
            </span>
          </div>

          {/* Column headers */}
          <div className="mono" style={{
            display: "grid", gridTemplateColumns: "minmax(260px,1.6fr) 1.4fr 120px 120px 80px",
            gap: 18, padding: "8px 14px", fontSize: 10.5,
            color: "var(--ink-3)", letterSpacing: "0.05em", textTransform: "uppercase",
            borderBottom: "1px solid var(--rule)",
          }}>
            <span>Name</span>
            <span>Job description</span>
            <span>Created</span>
            <span>Page count</span>
            <span style={{ textAlign: "right" }}>Actions</span>
          </div>
          {variants.map(v => <VariantRow key={v.id} v={v} />)}

          {/* Create new variant */}
          <a href="#/tailor" style={{
            marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: 14, border: "1px dashed var(--rule-strong)", color: "var(--ink-3)",
            fontSize: 13, borderRadius: 3,
          }}>
            <Glyph name="plus" size={13} /> New variant from a JD
          </a>
        </main>
      </div>
    </div>
  );
}
function MasterCard({ master }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "240px 1fr",
      border: "1px solid var(--ink)",
      background: "var(--paper)",
      borderRadius: 3,
      overflow: "hidden",
    }}>
      {/* Thumbnail */}
      <div style={{
        background: "var(--paper-2)", padding: 20, display: "flex", alignItems: "center", justifyContent: "center",
        borderRight: "1px solid var(--rule)",
      }}>
        <div style={{ transform: "scale(0.28)", transformOrigin: "top left", width: 810 * 0.28, height: 1050 * 0.28, position: "relative" }}>
          <div style={{ position: "absolute", top: 0, left: 0 }}>
            <PDFPreview scale={1} />
          </div>
        </div>
      </div>
      {/* Body */}
      <div style={{ padding: "22px 26px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="mono" style={{
            fontSize: 10, padding: "1px 6px",
            background: "var(--ink)", color: "var(--paper)",
            borderRadius: 2, letterSpacing: "0.06em", textTransform: "uppercase",
          }}>Master</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
            template: <span style={{ color: "var(--ink-2)" }}>jakes.sty</span>
          </span>
        </div>
        <h2 style={{ fontFamily: "var(--f-serif)", fontSize: 24, letterSpacing: "-0.015em", margin: "10px 0 6px" }}>
          {master.name}
        </h2>
        <p style={{ color: "var(--ink-2)", fontSize: 13, margin: 0, maxWidth: 440 }}>
          Your source of truth. Every variant is diffed off this — edit here first, then tailor.
        </p>
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <PageCountBadge state={master.pageCount} />
          <Meta label="Last edited" value={fmt.rel(master.lastEditedAt)} />
          <Meta label="Created" value="Nov 2025" />
          <Meta label="Versions" value="6" />
        </div>
        <div style={{ marginTop: "auto", paddingTop: 18, display: "flex", gap: 8 }}>
          <Button variant="primary" icon="doc" onClick={() => location.hash = "#/editor/r_master"}>Open editor</Button>
          <Button icon="sparkle" onClick={() => location.hash = "#/tailor"}>Tailor to JD</Button>
          <Button variant="ghost" icon="download">PDF</Button>
          <Button variant="ghost" icon="history" onClick={() => location.hash = "#/history"}>History</Button>
        </div>
      </div>
    </div>
  );
}
function Meta({ label, value }) {
  return (
    <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", display: "inline-flex", gap: 5 }}>
      <span>{label}:</span>
      <span style={{ color: "var(--ink-2)" }}>{value}</span>
    </span>
  );
}
function VariantRow({ v }) {
  const { jds } = window.FIXTURES;
  const jd = jds.find(j => j.id === v.jdId);
  return (
    <a href={`#/editor/${v.id}`} style={{
      display: "grid", gridTemplateColumns: "minmax(260px,1.6fr) 1.4fr 120px 120px 80px",
      gap: 18, padding: "14px 14px", alignItems: "center",
      borderBottom: "1px solid var(--rule)",
      fontSize: 13,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 3, height: 22, background: "var(--rule-strong)" }} />
        <span style={{ fontWeight: 500 }}>{v.name}</span>
      </span>
      <span style={{ color: "var(--ink-2)" }}>
        {jd ? <><b style={{ color: "var(--ink)" }}>{jd.company}</b> — {jd.title}</> : <span style={{ color: "var(--ink-3)" }}>No JD linked</span>}
      </span>
      <span className="mono" style={{ color: "var(--ink-3)", fontSize: 12 }}>{fmt.rel(v.createdAt)}</span>
      <span><PageCountBadge state={v.pageCount} size="sm" /></span>
      <span style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
        <button title="Open diff" onClick={(e) => { e.preventDefault(); location.hash = "#/diff"; }} style={{ padding: 5, color: "var(--ink-3)" }}>
          <Glyph name="eye" size={13} />
        </button>
        <button title="Download PDF" onClick={(e) => e.preventDefault()} style={{ padding: 5, color: "var(--ink-3)" }}>
          <Glyph name="download" size={13} />
        </button>
      </span>
    </a>
  );
}

// ============================================================
// 4. EDITOR (the hero)
// ============================================================
function EditorScreen({ resumeId = "r_stripe" }) {
  const { master, variants } = window.FIXTURES;
  const all = [master, ...variants];
  const resume = all.find(r => r.id === resumeId) || master;
  const overflow = resume.pageCount !== 1;

  const [section, setSection] = useStateA("experience");
  const [rawLatex, setRawLatex] = useStateA(false);
  const [chatOpen, setChatOpen] = useStateA(true);
  const [leftOpen, setLeftOpen] = useStateA(true);
  const [compiling, setCompiling] = useStateA(false);

  useEffectA(() => {
    document.body.setAttribute("data-overflow", overflow ? "true" : "false");
    return () => document.body.setAttribute("data-overflow", "false");
  }, [overflow]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome
        current={`Library / ${resume.name}`}
        autosave="2s ago"
        pageCount={compiling ? "compiling" : resume.pageCount}
        onCmdK={window.__openCmd}
      />
      {/* Overflow banner */}
      {overflow && (
        <div style={{
          background: "var(--err-soft)", borderBottom: "1px solid color-mix(in oklch, var(--err) 30%, transparent)",
          padding: "8px 16px", display: "flex", alignItems: "center", gap: 10,
          fontSize: 13, color: "var(--err)",
        }}>
          <Glyph name="warn" size={14} />
          <span style={{ fontWeight: 600 }}>Resume is {resume.pageCount} pages.</span>
          <span style={{ color: "var(--ink-2)" }}>Save as final is disabled until it's back to one page.</span>
          <span style={{ flex: 1 }} />
          <Button icon="sparkle" size="sm" variant="primary" onClick={() => setChatOpen(true)}>Ask Claude to tighten</Button>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left rail */}
        {leftOpen && <EditorLeftRail section={section} setSection={setSection} onClose={() => setLeftOpen(false)} resumeId={resume.id} />}

        {/* Center editor */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, borderRight: "1px solid var(--rule)" }}>
          <EditorToolbar
            section={section}
            rawLatex={rawLatex}
            setRawLatex={setRawLatex}
            leftOpen={leftOpen}
            setLeftOpen={setLeftOpen}
          />
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px 40px" }}>
            {rawLatex ? <RawLatexPanel section={section} /> : <FormEditor section={section} />}
          </div>
        </div>

        {/* PDF preview */}
        <div style={{ width: 420, display: "flex", flexDirection: "column", background: "var(--paper-2)", flexShrink: 0, borderRight: chatOpen ? "1px solid var(--rule)" : "none" }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "center", gap: 10, background: "var(--paper)" }}>
            <PageCountBadge state={compiling ? "compiling" : resume.pageCount} />
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {compiling ? "xelatex · 4,870 tokens cached" : "compiled 2s ago"}
            </span>
            <span style={{ flex: 1 }} />
            <button title="Download PDF" style={{ color: "var(--ink-2)", padding: 4 }}><Glyph name="download" size={13} /></button>
            <Button size="sm" disabled={overflow} variant={overflow ? "default" : "primary"} title={overflow ? `Can't save as final — ${resume.pageCount} pages` : "Save as final"}>
              Save as final
            </Button>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: 18, display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
            <div style={{ transform: "scale(0.5)", transformOrigin: "top center", width: 810 * 0.5 }}>
              <div style={{ transform: "scale(2)", transformOrigin: "top center" }}>
                <PDFPreview scale={0.5} compiling={compiling} overflow={overflow} variant={resume.id === "r_stripe" ? "stripe-new" : "master"} highlights={["new", "new"]} />
              </div>
            </div>
          </div>
        </div>

        {/* Claude rail */}
        {chatOpen ? (
          <ChatRail onClose={() => setChatOpen(false)} onCompileStart={() => { setCompiling(true); setTimeout(() => setCompiling(false), 1800); }} />
        ) : (
          <button onClick={() => setChatOpen(true)} title="Open Claude" style={{
            width: 36, borderLeft: "1px solid var(--rule)", display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 0", gap: 8, color: "var(--ink-2)",
          }}>
            <Glyph name="chat" size={14} />
            <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 11, fontFamily: "var(--f-mono)" }}>Claude</span>
          </button>
        )}
      </div>
    </div>
  );
}
function EditorLeftRail({ section, setSection, onClose, resumeId }) {
  const sections = [
    { id: "header", label: "Header" },
    { id: "experience", label: "Experience" },
    { id: "projects", label: "Projects" },
    { id: "education", label: "Education" },
    { id: "skills", label: "Skills" },
  ];
  const { history } = window.FIXTURES;
  const versions = history.filter(h => h.resume === resumeId || resumeId === "r_master");
  return (
    <aside style={{ width: 220, borderRight: "1px solid var(--rule)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--rule)" }}>
        <span className="eyebrow">Sections</span>
        <button onClick={onClose} title="Collapse" style={{ color: "var(--ink-3)", padding: 2 }}>
          <Glyph name="panel" size={13} />
        </button>
      </div>
      <div style={{ padding: 6 }}>
        {sections.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            padding: "6px 10px", fontSize: 13, textAlign: "left",
            color: section === s.id ? "var(--ink)" : "var(--ink-2)",
            background: section === s.id ? "var(--paper-2)" : "transparent",
            borderRadius: 3,
            position: "relative",
          }}>
            {section === s.id && <span style={{ position: "absolute", left: 0, top: 4, bottom: 4, width: 2, background: "var(--ink)" }} />}
            {s.label}
          </button>
        ))}
      </div>
      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--rule)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="eyebrow">Versions</span>
        <a href="#/history" style={{ fontSize: 11, fontFamily: "var(--f-mono)", color: "var(--ink-3)" }}>all →</a>
      </div>
      <div style={{ padding: 6, overflowY: "auto", flex: 1 }}>
        {versions.slice(0, 5).map((v, i) => (
          <a key={v.id} href="#/history" style={{ display: "block", padding: "6px 10px", borderRadius: 3, marginBottom: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <Glyph name={v.source === "ai" ? "sparkle" : "user"} size={11} />
              <span className="mono" style={{ color: "var(--ink-3)", fontSize: 10.5 }}>{v.id}</span>
              <span style={{ flex: 1 }} />
              <PageCountBadge state={v.pageCount} size="sm" showLabel={false} />
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>{fmt.rel(v.at)}</div>
          </a>
        ))}
      </div>
    </aside>
  );
}
function EditorToolbar({ section, rawLatex, setRawLatex, leftOpen, setLeftOpen }) {
  return (
    <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "center", gap: 10, background: "var(--paper)" }}>
      {!leftOpen && (
        <button onClick={() => setLeftOpen(true)} style={{ color: "var(--ink-3)", padding: 4 }} title="Show sections">
          <Glyph name="panel" size={13} />
        </button>
      )}
      <span style={{ fontFamily: "var(--f-serif)", fontSize: 15, fontWeight: 500, textTransform: "capitalize" }}>{section}</span>
      <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>· section 2 of 5</span>
      <div style={{ flex: 1 }} />
      <div style={{ display: "inline-flex", border: "1px solid var(--rule)", borderRadius: 3, overflow: "hidden" }}>
        <button onClick={() => setRawLatex(false)} style={{
          padding: "4px 10px", fontSize: 12, background: !rawLatex ? "var(--paper-2)" : "transparent",
          color: !rawLatex ? "var(--ink)" : "var(--ink-3)",
          borderRight: "1px solid var(--rule)",
        }}>Form</button>
        <button onClick={() => setRawLatex(true)} style={{
          padding: "4px 10px", fontSize: 12, background: rawLatex ? "var(--paper-2)" : "transparent",
          color: rawLatex ? "var(--ink)" : "var(--ink-3)",
          fontFamily: "var(--f-mono)",
        }}>.tex</button>
      </div>
    </div>
  );
}
function FormEditor({ section }) {
  if (section !== "experience") {
    return (
      <div style={{ maxWidth: 720 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Section</div>
        <h2 style={{ fontFamily: "var(--f-serif)", fontSize: 22, margin: "0 0 18px", textTransform: "capitalize" }}>{section}</h2>
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Form fields for {section} appear here.</div>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 720 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>Section · 2 of 5</div>
      <h2 style={{ fontFamily: "var(--f-serif)", fontSize: 22, margin: "0 0 18px", letterSpacing: "-0.01em" }}>Experience</h2>

      <ExperienceEntry
        title="Senior Software Engineer" org="Stratacore" loc="New York, NY"
        start="Aug 2022" end="Present"
        bullets={[
          "Led migration of the payments ledger to a sharded, idempotent, exactly-once pipeline — cut p99 write latency from 140ms to 38ms and eliminated double-charge incidents.",
          "Owned SOC2 evidence collection for the payments perimeter; drove the risk-control framework review with internal audit.",
          "Mentored four engineers through promotion; rewrote the onboarding runbook.",
        ]}
        aiTouched
      />
      <ExperienceEntry
        title="Software Engineer" org="Lintern" loc="Remote"
        start="Jun 2019" end="Aug 2022"
        bullets={[
          "Built the core type-inference engine for the Lintern static analyzer in Rust; shipped to 12k paying seats.",
          "Owned the VS Code extension; took ratings from 3.8 to 4.7 over 11 months.",
        ]}
      />

      <button style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 14px", marginTop: 8, width: "100%",
        border: "1px dashed var(--rule-strong)", color: "var(--ink-3)", fontSize: 13, borderRadius: 3,
      }}>
        <Glyph name="plus" size={13} /> Add role
      </button>
    </div>
  );
}
function ExperienceEntry({ title, org, loc, start, end, bullets, aiTouched }) {
  return (
    <div style={{ border: "1px solid var(--rule)", padding: 16, marginBottom: 14, background: "var(--paper)", borderRadius: 3 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <FakeField label="Title" value={title} />
        <FakeField label="Organization" value={org} />
        <FakeField label="Location" value={loc} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <FakeField label="Start" value={start} mono />
          <FakeField label="End" value={end} mono />
        </div>
      </div>
      <div className="eyebrow" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
        <span>Bullets</span>
        {aiTouched && (
          <span className="mono" style={{ fontSize: 10, color: "var(--ok)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Glyph name="sparkle" size={10} /> edited by Claude · 4m ago
          </span>
        )}
      </div>
      {bullets.map((b, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 10px", border: "1px solid var(--rule)", marginBottom: 6, borderRadius: 3, background: "var(--paper-2)" }}>
          <span style={{ color: "var(--ink-3)", fontFamily: "var(--f-mono)", fontSize: 11, marginTop: 2 }}>{String(i + 1).padStart(2, "0")}</span>
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
            {highlightTerms(b)}
          </div>
          <button style={{ color: "var(--ink-4)", padding: 2 }}><Glyph name="sparkle" size={11} /></button>
        </div>
      ))}
    </div>
  );
}
function FakeField({ label, value, mono }) {
  return (
    <label style={{ display: "block" }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{
        padding: "6px 10px", border: "1px solid var(--rule)", fontSize: 13, borderRadius: 3,
        fontFamily: mono ? "var(--f-mono)" : "var(--f-sans)",
      }}>{value}</div>
    </label>
  );
}
function highlightTerms(text) {
  const terms = ["idempotent", "exactly-once", "p99", "SOC2"];
  let parts = [text];
  terms.forEach(t => {
    const next = [];
    parts.forEach(p => {
      if (typeof p !== "string") { next.push(p); return; }
      const idx = p.indexOf(t);
      if (idx < 0) { next.push(p); return; }
      next.push(p.slice(0, idx));
      next.push(<mark key={t} style={{ background: "color-mix(in oklch, var(--ok) 15%, transparent)", borderBottom: "1.5px solid var(--ok)", padding: "0 2px", color: "var(--ink)" }}>{t}</mark>);
      next.push(p.slice(idx + t.length));
    });
    parts = next;
  });
  return parts;
}
function RawLatexPanel({ section }) {
  const lines = [
    `\\section*{Experience}`,
    `\\textbf{Senior Software Engineer} \\hfill \\textit{Stratacore} \\\\`,
    `\\textit{Aug 2022 -- Present} \\hfill New York, NY`,
    `\\begin{itemize}[leftmargin=*,nosep]`,
    `  \\item Led migration of the payments ledger to a sharded, \\textbf{idempotent, exactly-once} pipeline --- cut \\textbf{p99} write latency from 140ms to 38ms and eliminated double-charge incidents.`,
    `  \\item Owned \\textbf{SOC2} evidence collection for the payments perimeter; drove the risk-control framework review with internal audit.`,
    `  \\item Mentored four engineers through promotion; rewrote the onboarding runbook.`,
    `\\end{itemize}`,
    ``,
    `\\textbf{Software Engineer} \\hfill \\textit{Lintern} \\\\`,
    `\\textit{Jun 2019 -- Aug 2022} \\hfill Remote`,
    `\\begin{itemize}[leftmargin=*,nosep]`,
    `  \\item Built the core type-inference engine for the Lintern static analyzer in Rust; shipped to 12k paying seats.`,
    `  \\item Owned the VS Code extension; took ratings from 3.8 to 4.7 over 11 months.`,
    `\\end{itemize}`,
  ];
  return (
    <div style={{ border: "1px solid var(--rule)", borderRadius: 3, background: "var(--paper)", overflow: "hidden", maxWidth: 820 }}>
      <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", fontFamily: "var(--f-mono)", fontSize: 12.5, lineHeight: 1.65 }}>
        {lines.map((l, i) => (
          <React.Fragment key={i}>
            <div style={{ textAlign: "right", padding: "0 10px", color: "var(--ink-4)", background: "var(--paper-2)", borderRight: "1px solid var(--rule)", fontSize: 11 }}>{i + 1}</div>
            <div style={{ padding: "0 14px", whiteSpace: "pre", color: "var(--ink)" }}>
              {colorizeLatex(l)}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
function colorizeLatex(line) {
  // \command in one color, {args} ink, comments grey
  const parts = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\\") {
      let j = i + 1;
      while (j < line.length && /[A-Za-z*]/.test(line[j])) j++;
      parts.push(<span key={parts.length} style={{ color: "oklch(0.45 0.12 260)" }}>{line.slice(i, j)}</span>);
      i = j;
    } else if (line[i] === "%") {
      parts.push(<span key={parts.length} style={{ color: "var(--ink-3)" }}>{line.slice(i)}</span>);
      i = line.length;
    } else if (line[i] === "{" || line[i] === "}" || line[i] === "[" || line[i] === "]") {
      parts.push(<span key={parts.length} style={{ color: "oklch(0.55 0.1 40)" }}>{line[i]}</span>);
      i++;
    } else {
      let j = i;
      while (j < line.length && !"\\%{}[]".includes(line[j])) j++;
      parts.push(line.slice(i, j));
      i = j;
    }
  }
  return parts;
}

// ---- Chat rail ----
function ChatRail({ onClose, onCompileStart }) {
  const [messages, setMessages] = useStateA([
    { role: "user", text: "Tailor the experience bullets for the Stripe JD — emphasize ledger work, compliance, and reliability." },
    { role: "assistant", kind: "think", text: "Reading JD · extracting keywords: idempotent, exactly-once, p99, SOC2, PCI-DSS, on-call." },
    { role: "assistant", text: "I'll tighten the Stratacore bullets and swap the feature-flag bullet for one on SOC2 evidence collection — it's more load-bearing for this role." },
    { role: "event", kind: "compile-done", data: { model: "sonnet", iterations: 2, tokensCached: 12840, tokensFresh: 1920, wallMs: 4200, pageCount: 1 } },
    { role: "assistant", text: "Applied 2 edits. Compile is clean at 1 page. Ready to review the diff?" , diffAction: true },
  ]);
  const [input, setInput] = useStateA("");
  const [streaming, setStreaming] = useStateA(false);
  const scrollerRef = useRefA(null);
  useEffectA(() => { scrollerRef.current?.scrollTo({ top: 9e9 }); }, [messages]);

  const send = () => {
    if (!input.trim()) return;
    const u = input;
    setInput("");
    setMessages(m => [...m, { role: "user", text: u }]);
    setStreaming(true);
    onCompileStart?.();
    setTimeout(() => {
      setMessages(m => [...m, { role: "assistant", kind: "think", text: "Routing to Haiku 4.5 — quick edit, no JD rescan needed." }]);
    }, 400);
    setTimeout(() => {
      setMessages(m => [...m, { role: "assistant", text: "Tightened the Lintern bullet — cut 'took ratings from 3.8 to 4.7' down to 'lifted ratings 3.8→4.7'. Recompiling…" }]);
    }, 900);
    setTimeout(() => {
      setMessages(m => [...m, { role: "event", kind: "compile-done", data: { model: "haiku", iterations: 1, tokensCached: 14210, tokensFresh: 620, wallMs: 1300, pageCount: 1 } }]);
      setStreaming(false);
    }, 1800);
  };

  return (
    <aside style={{ width: 360, display: "flex", flexDirection: "column", flexShrink: 0, background: "var(--paper)" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "center", gap: 10 }}>
        <Glyph name="chat" size={13} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>Claude</span>
        <ModelBadge model="sonnet" size="sm" />
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ color: "var(--ink-3)", padding: 4 }} title="Close"><Glyph name="panel-r" size={13} /></button>
      </div>
      <div ref={scrollerRef} style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        <Preset onClick={send} />
        {messages.map((m, i) => <ChatMessage key={i} m={m} last={i === messages.length - 1 && streaming} />)}
      </div>
      <div style={{ padding: 10, borderTop: "1px solid var(--rule)" }}>
        <div style={{ border: "1px solid var(--rule-strong)", borderRadius: 3, padding: 6, background: "var(--paper)" }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask Claude to edit, tighten, or tailor…"
            style={{
              width: "100%", minHeight: 52, border: "none", outline: "none",
              resize: "none", background: "transparent", padding: "2px 4px",
              fontSize: 13, color: "var(--ink)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 2px" }}>
            <PresetChip>Tailor to JD</PresetChip>
            <PresetChip>Tighten to 1 page</PresetChip>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="primary" onClick={send} disabled={!input.trim()}>Send</Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
function Preset({ onClick }) {
  return (
    <div style={{ padding: 10, border: "1px dashed var(--rule-strong)", borderRadius: 3, display: "flex", alignItems: "center", gap: 10 }}>
      <Glyph name="sparkle" size={13} />
      <div style={{ flex: 1, fontSize: 12, color: "var(--ink-2)" }}>
        <b style={{ color: "var(--ink)" }}>Tailor to JD</b> — paste a job description to produce a variant.
      </div>
      <a href="#/tailor" style={{ fontSize: 12, fontFamily: "var(--f-mono)", color: "var(--ink)", textDecoration: "underline" }}>open →</a>
    </div>
  );
}
function PresetChip({ children }) {
  return (
    <button className="mono" style={{
      fontSize: 11, color: "var(--ink-2)", padding: "2px 7px",
      border: "1px solid var(--rule)", borderRadius: 2, background: "var(--paper-2)",
    }}>{children}</button>
  );
}
function ChatMessage({ m, last }) {
  if (m.role === "event" && m.kind === "compile-done") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="eyebrow" style={{ color: "var(--ink-3)" }}>compile</div>
        <CompileChip {...m.data} />
      </div>
    );
  }
  if (m.role === "user") {
    return (
      <div style={{ alignSelf: "flex-end", maxWidth: "85%", background: "var(--paper-2)", border: "1px solid var(--rule)", borderRadius: 3, padding: "8px 10px", fontSize: 13, lineHeight: 1.5 }}>
        {m.text}
      </div>
    );
  }
  if (m.role === "assistant" && m.kind === "think") {
    return (
      <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", paddingLeft: 2, display: "flex", alignItems: "center", gap: 6 }}>
        <Glyph name="dots" size={10} />
        <span>{m.text}</span>
      </div>
    );
  }
  return (
    <div style={{ fontSize: 13, lineHeight: 1.55, display: "flex", flexDirection: "column", gap: 6 }}>
      <div className={last ? "caret" : ""}>{m.text}</div>
      {m.diffAction && (
        <a href="#/diff" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 8px", fontSize: 12, alignSelf: "flex-start",
          border: "1px solid var(--rule-strong)", borderRadius: 3, color: "var(--ink)",
          background: "var(--paper-2)",
        }}>
          Review diff <Glyph name="arrow-r" size={12} />
        </a>
      )}
    </div>
  );
}

// ============================================================
// 5. DIFF VIEWER (modal)
// ============================================================
function DiffScreen() {
  const { diff } = window.FIXTURES;
  const overridable = diff.finalPageCount !== 1 || diff.removedProtected.length > 0;

  return (
    <div style={{ height: "100%", background: "var(--paper)", display: "flex", flexDirection: "column" }}>
      <TopChrome current="Library / Stripe variant / Diff" onCmdK={window.__openCmd} autosave="2s ago" />
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--rule)", background: "var(--paper)", display: "flex", alignItems: "center", gap: 14 }}>
        <div>
          <div className="eyebrow">Review diff · Sonnet 4.6</div>
          <div style={{ fontFamily: "var(--f-serif)", fontSize: 17, marginTop: 2 }}>Stratacore bullets → Stripe tailoring</div>
        </div>
        <span style={{ flex: 1 }} />
        <CompileChip model={diff.model} iterations={diff.iterations} tokensCached={diff.tokensCached} tokensFresh={diff.tokensFresh} wallMs={diff.wallMs} pageCount={diff.finalPageCount} />
      </div>

      {/* Protected terms strip */}
      <div style={{ padding: "8px 24px", borderBottom: "1px solid var(--rule)", background: "var(--paper-2)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="eyebrow">Protected terms</span>
        {diff.preservedProtected.map(t => <TermPill key={t}>{t}</TermPill>)}
        {diff.removedProtected.length > 0 && (
          <>
            <span style={{ color: "var(--rule-strong)" }}>·</span>
            <span className="eyebrow" style={{ color: "var(--err)" }}>Removed · blocking</span>
            {diff.removedProtected.map(t => <TermPill key={t} variant="removed">{t}</TermPill>)}
          </>
        )}
      </div>

      {/* Body: side-by-side diff + PDF preview */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", overflow: "hidden" }}>
        {/* LaTeX diff */}
        <div style={{ borderRight: "1px solid var(--rule)", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ padding: "6px 14px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--f-mono)" }}>
            <Glyph name="doc" size={12} /> experience.tex
            <span style={{ flex: 1 }} />
            <span style={{ color: "var(--err)" }}>−2</span>
            <span style={{ color: "var(--ok)" }}>+2</span>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            <DiffTable lines={diff.lines} />
          </div>
        </div>

        {/* PDF side-by-side */}
        <div style={{ display: "flex", flexDirection: "column", background: "var(--paper-2)" }}>
          <div style={{ padding: "6px 14px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--f-mono)", background: "var(--paper)" }}>
            <Glyph name="eye" size={12} /> rendered output
            <span style={{ flex: 1 }} />
            <span>before</span> · <span>after</span>
          </div>
          <div style={{ flex: 1, overflow: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: 14 }}>
            <PDFColumn label="before" hotspots={[{ id: 1, top: 150 }, { id: 2, top: 196 }]} highlights={[null, null]} variant="master" />
            <PDFColumn label="after" accent hotspots={[{ id: 1, top: 150 }, { id: 2, top: 196 }]} highlights={["new", "new"]} variant="stripe-new" />
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div style={{ padding: "12px 24px", borderTop: "1px solid var(--rule)", background: "var(--paper)", display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" onClick={() => history.back()}>Reject</Button>
        <Button variant="default">Request changes</Button>
        <span style={{ flex: 1 }} />
        <PageCountBadge state={diff.finalPageCount} />
        {overridable ? (
          <Button variant="danger" onClick={() => alert("Override")}>Override and accept anyway</Button>
        ) : (
          <Button variant="primary" icon="check" onClick={() => location.hash = "#/editor/r_stripe"}>Accept changes</Button>
        )}
      </div>
    </div>
  );
}
function DiffTable({ lines }) {
  return (
    <div style={{ fontFamily: "var(--f-mono)", fontSize: 12.5, lineHeight: 1.6 }}>
      {lines.map((l, i) => {
        const bg = l.type === "add" ? "color-mix(in oklch, var(--ok) 8%, transparent)"
                 : l.type === "del" ? "color-mix(in oklch, var(--err) 8%, transparent)"
                 : "transparent";
        const mark = l.type === "add" ? "+" : l.type === "del" ? "−" : " ";
        const col = l.type === "add" ? "var(--ok)" : l.type === "del" ? "var(--err)" : "var(--ink-3)";
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "40px 18px 1fr 26px", background: bg, borderLeft: `2px solid ${l.type === "ctx" ? "transparent" : col}` }}>
            <span style={{ textAlign: "right", padding: "0 8px", color: "var(--ink-4)", fontSize: 10.5 }}>{i + 1}</span>
            <span style={{ textAlign: "center", color: col, fontWeight: 700 }}>{mark}</span>
            <span style={{ padding: "0 4px", color: "var(--ink)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{colorizeLatex(l.text)}</span>
            <span style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 10.5 }}>
              {l.hotspot && <span style={{ display: "inline-flex", width: 16, height: 16, borderRadius: "50%", border: "1px solid var(--rule-strong)", alignItems: "center", justifyContent: "center", background: "var(--paper)", color: "var(--ink-2)" }}>{l.hotspot}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
function PDFColumn({ label, accent, hotspots, highlights, variant }) {
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative" }}>
        <div style={{ transform: "scale(0.5)", transformOrigin: "top center", width: 810 * 0.5 }}>
          <div style={{ transform: "scale(2)", transformOrigin: "top center" }}>
            <PDFPreview scale={0.5} variant={variant} highlights={highlights} />
          </div>
        </div>
        {hotspots?.map(h => (
          <span key={h.id} style={{
            position: "absolute", top: h.top * 0.5 + 10, left: accent ? -10 : 405 + 10,
            width: 18, height: 18, borderRadius: "50%",
            background: "var(--paper)", border: "1px solid var(--ink)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--ink)",
          }}>{h.id}</span>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 11, color: accent ? "var(--ok)" : "var(--ink-3)", fontWeight: accent ? 600 : 400 }}>
        {label}
      </div>
    </div>
  );
}

Object.assign(window, {
  LoginScreen, OnboardingScreen, LibraryScreen, EditorScreen, DiffScreen,
  colorizeLatex, highlightTerms, PDFColumn, DiffTable,
});
