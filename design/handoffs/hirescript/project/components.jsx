// HireScript — shared components
// Exports to window: PageCountBadge, CompileChip, ModelBadge, TermPill,
// VariantCard, VersionRow, TopChrome, NavRail, Glyph, PDFPreview, Skeleton,
// Button, Field, fmt, useHash

const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;

// ---- tiny geometric glyphs (no emoji; no icon-heavy toolbar) ----
function Glyph({ name, size = 14, stroke = 1.5 }) {
  const s = size;
  const sw = stroke;
  const props = { width: s, height: s, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  switch (name) {
    case "check":   return <svg {...props}><path d="M3.5 8.5l3 3 6-7" /></svg>;
    case "cross":   return <svg {...props}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
    case "dots":    return <svg {...props}><circle cx="3" cy="8" r="0.8" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none" /><circle cx="13" cy="8" r="0.8" fill="currentColor" stroke="none" /></svg>;
    case "warn":    return <svg {...props}><path d="M8 2l6 11H2z" /><path d="M8 7v3" /><circle cx="8" cy="12" r="0.5" fill="currentColor" stroke="none" /></svg>;
    case "dash":    return <svg {...props}><path d="M3 8h10" /></svg>;
    case "doc":     return <svg {...props}><path d="M4 2h5l3 3v9H4z" /><path d="M9 2v3h3" /></svg>;
    case "docs":    return <svg {...props}><path d="M3 3h6l3 3v7H3z" /><path d="M6 6h6v7" /></svg>;
    case "history": return <svg {...props}><path d="M3 8a5 5 0 1 0 1.5-3.5" /><path d="M3 3v3h3" /><path d="M8 5v3l2 2" /></svg>;
    case "sparkle": return <svg {...props}><path d="M8 2v4M8 10v4M2 8h4M10 8h4" /></svg>;
    case "chat":    return <svg {...props}><path d="M3 4h10v7H7l-3 3v-3H3z" /></svg>;
    case "gear":    return <svg {...props}><circle cx="8" cy="8" r="2.2" /><path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4" /></svg>;
    case "plus":    return <svg {...props}><path d="M8 3v10M3 8h10" /></svg>;
    case "cmd":     return <svg {...props}><path d="M5.5 3.5A1.5 1.5 0 1 0 4 5h8a1.5 1.5 0 1 0-1.5-1.5v8A1.5 1.5 0 1 0 12 11H4a1.5 1.5 0 1 0 1.5 1.5v-8z" /></svg>;
    case "arrow-r": return <svg {...props}><path d="M4 8h8M9 5l3 3-3 3" /></svg>;
    case "chevron-d": return <svg {...props}><path d="M4 6l4 4 4-4" /></svg>;
    case "chevron-r": return <svg {...props}><path d="M6 4l4 4-4 4" /></svg>;
    case "eye":     return <svg {...props}><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.8" /></svg>;
    case "download": return <svg {...props}><path d="M8 2v9M4 8l4 4 4-4M3 13.5h10" /></svg>;
    case "upload":  return <svg {...props}><path d="M8 13V4M4 7l4-4 4 4M3 13.5h10" /></svg>;
    case "paste":   return <svg {...props}><path d="M5 3h6v2H5z" /><path d="M4 4H3v10h10V4h-1" /></svg>;
    case "search":  return <svg {...props}><circle cx="7" cy="7" r="4" /><path d="M10 10l3 3" /></svg>;
    case "user":    return <svg {...props}><circle cx="8" cy="6" r="2.5" /><path d="M3 13c1-2.5 3-3.5 5-3.5s4 1 5 3.5" /></svg>;
    case "panel":   return <svg {...props}><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M6 3v10" /></svg>;
    case "panel-r": return <svg {...props}><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M10 3v10" /></svg>;
    case "sun":     return <svg {...props}><circle cx="8" cy="8" r="2.5" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" /></svg>;
    case "moon":    return <svg {...props}><path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z" /></svg>;
    case "undo":    return <svg {...props}><path d="M3 8h7a3 3 0 0 1 0 6H6" /><path d="M5 5L2.5 7.5 5 10" /></svg>;
    case "filter":  return <svg {...props}><path d="M2 3h12l-4.5 6v4l-3 1.5v-5.5z" /></svg>;
    case "link":    return <svg {...props}><path d="M7 9l2-2M6 10L4 12a2 2 0 0 1-2.8-2.8l2-2M10 6l2-2a2 2 0 0 1 2.8 2.8l-2 2" /></svg>;
    default: return null;
  }
}

// ---- formatting helpers ----
const fmt = {
  rel(iso) {
    const d = new Date(iso);
    const now = new Date("2026-04-24T10:30:00Z").getTime();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff/86400)}d ago`;
    return d.toISOString().slice(0,10);
  },
  dt(iso) {
    const d = new Date(iso);
    return d.toISOString().replace("T", " ").slice(0, 16);
  },
  num(n) { return n.toLocaleString("en-US"); },
};

// ---- PageCountBadge — the workhorse ----
function PageCountBadge({ state, size = "md", showLabel = true }) {
  // state: 1 | 2 | 'compiling' | 'error' | 'unknown'
  const cfg = (() => {
    if (state === 1) return { glyph: "check", label: "1 page", tone: "ok" };
    if (typeof state === "number" && state !== 1) return { glyph: "cross", label: `${state} pages`, tone: "err" };
    if (state === "compiling") return { glyph: "dots", label: "compiling", tone: "muted" };
    if (state === "error") return { glyph: "warn", label: "compile error", tone: "err" };
    return { glyph: "dash", label: "unknown", tone: "muted" };
  })();

  const tones = {
    ok:    { bg: "var(--ok-soft)",  fg: "var(--ok)",  bd: "color-mix(in oklch, var(--ok) 25%, transparent)" },
    err:   { bg: "var(--err-soft)", fg: "var(--err)", bd: "color-mix(in oklch, var(--err) 30%, transparent)" },
    muted: { bg: "var(--paper-2)",  fg: "var(--ink-3)", bd: "var(--rule)" },
  }[cfg.tone];

  const sizes = {
    sm: { padY: 1, padX: 5, fs: 10.5, gap: 3, gs: 10 },
    md: { padY: 2, padX: 7, fs: 11.5, gap: 4, gs: 12 },
    lg: { padY: 4, padX: 10, fs: 13, gap: 6, gs: 14 },
  }[size];

  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sizes.gap,
        padding: `${sizes.padY}px ${sizes.padX}px`,
        background: tones.bg,
        color: tones.fg,
        border: `1px solid ${tones.bd}`,
        borderRadius: 3,
        fontSize: sizes.fs,
        fontWeight: 500,
        lineHeight: 1,
        letterSpacing: "0.01em",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
      title={`Page count: ${cfg.label}`}
    >
      <span style={{ display: "inline-flex", animation: state === "compiling" ? "blink 1.2s steps(1) infinite" : "none" }}>
        <Glyph name={cfg.glyph} size={sizes.gs} stroke={2} />
      </span>
      {showLabel && <span>{cfg.label}</span>}
    </span>
  );
}

// ---- ModelBadge ----
function ModelBadge({ model, size = "md" }) {
  const cfg = {
    haiku:  { label: "Haiku 4.5",  hue: "var(--haiku)" },
    sonnet: { label: "Sonnet 4.6", hue: "var(--sonnet)" },
    opus:   { label: "Opus 4.7",   hue: "var(--opus)" },
  }[model] || { label: model, hue: "var(--ink-3)" };

  const sizes = { sm: { fs: 10.5, padY: 1, padX: 5, dot: 5 }, md: { fs: 11.5, padY: 2, padX: 7, dot: 6 } }[size];

  return (
    <span className="mono" style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: `${sizes.padY}px ${sizes.padX}px`,
      border: "1px solid var(--rule)",
      borderRadius: 3,
      fontSize: sizes.fs, color: "var(--ink-2)", background: "var(--paper)",
      whiteSpace: "nowrap",
    }}>
      <span style={{ width: sizes.dot, height: sizes.dot, borderRadius: "50%", background: cfg.hue, display: "inline-block" }} />
      {cfg.label}
    </span>
  );
}

// ---- CompileChip: model · iter · tokens · wall-ms ----
function CompileChip({ model, iterations, tokensCached, tokensFresh, wallMs, pageCount, kind = "done" }) {
  // kind: 'done' | 'compiling'
  return (
    <span className="mono" style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      padding: "3px 8px",
      border: "1px solid var(--rule)",
      background: "var(--paper-2)",
      color: "var(--ink-2)",
      fontSize: 11,
      borderRadius: 3,
      flexWrap: "wrap",
    }}>
      {kind === "compiling" ? (
        <>
          <span style={{ color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ animation: "blink 1.2s steps(1) infinite" }}><Glyph name="dots" size={11} stroke={2} /></span>
            compiling…
          </span>
        </>
      ) : (
        <>
          <ModelBadge model={model} size="sm" />
          <Sep />
          <span>iter {iterations}</span>
          <Sep />
          <span>{fmt.num(tokensCached)} cached · {fmt.num(tokensFresh)} fresh</span>
          <Sep />
          <span>{(wallMs/1000).toFixed(1)}s</span>
          {pageCount != null && (<><Sep /><PageCountBadge state={pageCount} size="sm" /></>)}
        </>
      )}
    </span>
  );
}
function Sep() {
  return <span style={{ color: "var(--rule-strong)" }}>·</span>;
}

// ---- TermPill (protected term) ----
function TermPill({ children, variant = "preserved", onRemove }) {
  const sty = variant === "preserved"
    ? { bg: "transparent", fg: "var(--ok)", bd: "color-mix(in oklch, var(--ok) 40%, transparent)" }
    : { bg: "var(--err-soft)", fg: "var(--err)", bd: "color-mix(in oklch, var(--err) 30%, transparent)" };
  return (
    <span className="mono" style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 7px",
      border: `1px solid ${sty.bd}`,
      background: sty.bg,
      color: sty.fg,
      fontSize: 11,
      borderRadius: 3,
      whiteSpace: "nowrap",
    }}>
      {variant === "removed" && <Glyph name="cross" size={10} stroke={2} />}
      {children}
      {onRemove && (
        <button onClick={onRemove} style={{ color: "inherit", opacity: 0.6, display: "inline-flex" }} title="Remove">
          <Glyph name="cross" size={10} stroke={2} />
        </button>
      )}
    </span>
  );
}

// ---- Button ----
function Button({ children, variant = "default", size = "md", disabled, onClick, icon, iconRight, title, style, mono, kbd }) {
  const base = {
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: size === "sm" ? "4px 9px" : size === "lg" ? "9px 16px" : "6px 12px",
    fontSize: size === "sm" ? 12 : size === "lg" ? 14 : 13,
    border: "1px solid var(--rule-strong)",
    background: "var(--paper)",
    color: "var(--ink)",
    borderRadius: 3,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    transition: "background 120ms, border-color 120ms",
    fontFamily: mono ? "var(--f-mono)" : "var(--f-sans)",
    letterSpacing: mono ? "0.01em" : "0",
    whiteSpace: "nowrap",
  };
  const variants = {
    default: {},
    primary: { background: "var(--ink)", color: "var(--paper)", borderColor: "var(--ink)" },
    ghost:   { background: "transparent", borderColor: "transparent", color: "var(--ink-2)" },
    danger:  { background: "var(--accent)", color: "var(--paper)", borderColor: "var(--accent)" },
    subtle:  { background: "var(--paper-2)", borderColor: "var(--rule)" },
  }[variant];

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={title}
      style={{ ...base, ...variants, ...style }}
      onMouseEnter={(e) => { if (!disabled && variant === "default") e.currentTarget.style.background = "var(--paper-2)"; }}
      onMouseLeave={(e) => { if (!disabled && variant === "default") e.currentTarget.style.background = "var(--paper)"; }}
    >
      {icon && <span style={{ display: "inline-flex", opacity: 0.9 }}><Glyph name={icon} size={13} /></span>}
      <span>{children}</span>
      {iconRight && <span style={{ display: "inline-flex", opacity: 0.8 }}><Glyph name={iconRight} size={13} /></span>}
      {kbd && <span className="mono" style={{ fontSize: 10.5, color: "currentColor", opacity: 0.55, border: "1px solid currentColor", borderColor: "color-mix(in oklch, currentColor 30%, transparent)", padding: "1px 4px", borderRadius: 2, marginLeft: 4 }}>{kbd}</span>}
    </button>
  );
}

// ---- Field (label + input) ----
function Field({ label, hint, children, suffix }) {
  return (
    <label style={{ display: "block" }}>
      {label && <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>}
      <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--rule-strong)", background: "var(--paper)", borderRadius: 3 }}>
        {children}
        {suffix && <span style={{ padding: "0 10px", color: "var(--ink-3)", fontSize: 12 }}>{suffix}</span>}
      </div>
      {hint && <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>{hint}</div>}
    </label>
  );
}
function Input(props) {
  return <input {...props} style={{
    flex: 1, border: "none", outline: "none", background: "transparent",
    padding: "8px 10px", fontSize: 13, color: "var(--ink)",
    ...props.style
  }} />;
}

// ---- PDFPreview: fake rendered resume (reads like one page) ----
// Renders a "PDF page" with the resume content laid out typographically.
// Accepts scale 0..1 and compiling flag.
function PDFPreview({ scale = 1, compiling = false, overflow = false, highlights = [], variant = "master" }) {
  const pageH = 1050 * scale;
  const pageW = 810 * scale;

  // Variant variants (for diff viewer to show "old" vs "new")
  const stripe = variant === "stripe-new" || variant === "stripe-old";

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <div style={{
        width: pageW, minHeight: pageH,
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        boxShadow: "0 1px 0 var(--rule), 0 8px 24px -12px oklch(0 0 0 / 0.12)",
        padding: 40 * scale,
        color: "var(--ink)",
        fontFamily: "'Source Serif 4', Georgia, serif",
        fontSize: 10 * scale,
        lineHeight: 1.35,
        position: "relative",
        overflow: "hidden",
        filter: compiling ? "grayscale(0.1)" : "none",
      }}>
        {/* Name */}
        <div style={{ textAlign: "center", marginBottom: 10 * scale }}>
          <div style={{ fontWeight: 700, fontSize: 22 * scale, letterSpacing: "0.01em" }}>Maya Okafor</div>
          <div style={{ fontSize: 10 * scale, color: "var(--ink-2)" }}>
            {stripe ? "Payments Infrastructure Engineer" : "Software Engineer"} · Brooklyn, NY
          </div>
          <div style={{ fontSize: 10 * scale, color: "var(--ink-2)" }}>
            maya@okafor.dev · +1 (646) 555-0139 · github.com/maya-ok
          </div>
        </div>
        <Hr scale={scale} />
        <SectionHeading scale={scale}>Experience</SectionHeading>
        <JobBlock scale={scale}
          title="Senior Software Engineer" org="Stratacore"
          dates="Aug 2022 — Present" loc="New York, NY"
          bullets={
            variant === "stripe-new" ? [
              <>Led migration of the payments ledger to a sharded, <Mark hl={highlights[0]}><b>idempotent, exactly-once</b></Mark> pipeline — cut <Mark hl={highlights[0]}><b>p99</b></Mark> write latency from 140ms to 38ms and eliminated double-charge incidents.</>,
              <>Owned <Mark hl={highlights[1]}><b>SOC2</b></Mark> evidence collection for the payments perimeter; drove the risk-control framework review with internal audit.</>,
              <>Mentored four engineers through promotion; rewrote the onboarding runbook.</>,
            ] : [
              <>Led migration of the payments ledger from Postgres to a sharded CockroachDB cluster, cutting p99 write latency from 140ms to 38ms.</>,
              <>Designed the feature-flag service used by 140+ engineers; authored the Go SDK and handled on-call rotation ownership.</>,
              <>Mentored four engineers through promotion; rewrote the onboarding runbook.</>,
            ]
          }
        />
        <JobBlock scale={scale}
          title="Software Engineer" org="Lintern"
          dates="Jun 2019 — Aug 2022" loc="Remote"
          bullets={[
            <>Built the core type-inference engine for the Lintern static analyzer in Rust; shipped to 12k paying seats.</>,
            <>Owned the VS Code extension; took ratings from 3.8 to 4.7 over 11 months.</>,
          ]}
        />
        <SectionHeading scale={scale}>Projects</SectionHeading>
        <div style={{ marginBottom: 4 * scale }}><b>tinyrope</b> — a 600-line LaTeX-aware diff tool in Rust. 2.1k stars.</div>
        <div style={{ marginBottom: 10 * scale }}><b>pdfpeek</b> — browser extension for inline PDF annotation, 40k weekly users.</div>
        <SectionHeading scale={scale}>Education</SectionHeading>
        <div style={{ marginBottom: 10 * scale, display: "flex", justifyContent: "space-between" }}>
          <span><b>B.S. Computer Science</b>, Carnegie Mellon University</span>
          <span style={{ color: "var(--ink-2)" }}>2015 — 2019</span>
        </div>
        <SectionHeading scale={scale}>Skills</SectionHeading>
        <div>Go, Rust, TypeScript, Python, Postgres, CockroachDB, Kafka, Kubernetes, Terraform, AWS.</div>

        {overflow && (
          <div style={{ position: "absolute", left: 0, right: 0, top: pageH - 18 * scale,
            borderTop: "1px dashed var(--err)", color: "var(--err)", fontFamily: "var(--f-mono)", fontSize: 10 * scale,
            padding: `2px ${40 * scale}px`, background: "color-mix(in oklch, var(--err) 8%, transparent)",
          }}>
            ── page 1 / 2 break ──────────────────────
          </div>
        )}

        {compiling && <div className="scan-shimmer" />}
      </div>
      {/* Page decoration — shadow of second page if overflow */}
      {overflow && (
        <div style={{
          position: "absolute", top: 8, left: 6, width: pageW, height: pageH * 0.3,
          background: "var(--paper)", border: "1px solid var(--rule)",
          zIndex: -1,
          boxShadow: "0 8px 24px -12px oklch(0 0 0 / 0.1)",
        }} />
      )}
    </div>
  );
}
function Hr({ scale }) { return <div style={{ height: 1, background: "var(--rule)", margin: `${6*scale}px 0` }} />; }
function SectionHeading({ children, scale }) {
  return <div style={{
    textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 10 * scale,
    fontFamily: "var(--f-sans)", fontWeight: 600, color: "var(--ink)",
    borderBottom: "1px solid var(--ink)", paddingBottom: 2 * scale, marginBottom: 4 * scale, marginTop: 8 * scale,
  }}>{children}</div>;
}
function JobBlock({ title, org, dates, loc, bullets, scale }) {
  return (
    <div style={{ marginBottom: 8 * scale }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span><b>{title}</b> — <i>{org}</i></span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--ink-2)", fontStyle: "italic" }}>
        <span>{dates}</span><span>{loc}</span>
      </div>
      <ul style={{ margin: `${3*scale}px 0 0 ${14*scale}px`, padding: 0 }}>
        {bullets.map((b, i) => <li key={i} style={{ marginBottom: 2 * scale }}>{b}</li>)}
      </ul>
    </div>
  );
}
function Mark({ children, hl }) {
  if (!hl) return <>{children}</>;
  return <span style={{
    background: hl === "new" ? "color-mix(in oklch, var(--ok) 15%, transparent)" : "color-mix(in oklch, var(--warn) 18%, transparent)",
    borderBottom: `1.5px solid ${hl === "new" ? "var(--ok)" : "var(--warn)"}`,
    padding: "0 2px",
  }}>{children}</span>;
}

// ---- Skeleton ----
function Skeleton({ w = "100%", h = 14, style }) {
  return <div style={{ width: w, height: h, background: "var(--paper-3)", borderRadius: 2, ...style }} />;
}

// ---- VariantCard / VersionRow are defined per-screen for flexibility ----

// ---- TopChrome ----
function TopChrome({ current, autosave, pageCount, onCmdK }) {
  const theme = useTheme();
  return (
    <header id="top-chrome" style={{
      height: "var(--top-chrome)", display: "flex", alignItems: "center",
      borderBottom: "1px solid var(--rule)",
      padding: "0 12px", gap: 12, background: "var(--paper)", flexShrink: 0,
    }}>
      <a href="#/library" style={{ display: "flex", alignItems: "center", gap: 7, paddingRight: 10, borderRight: "1px solid var(--rule)", height: "100%" }}>
        <Wordmark />
      </a>
      <Crumbs current={current} />
      <div style={{ flex: 1 }} />
      {autosave && (
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
          saved {autosave}
        </span>
      )}
      {pageCount != null && <PageCountBadge state={pageCount} />}
      <button onClick={onCmdK} title="Command palette (⌘K)" style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        border: "1px solid var(--rule)", padding: "3px 8px", borderRadius: 3,
        color: "var(--ink-3)", fontSize: 12, fontFamily: "var(--f-mono)",
        background: "var(--paper)",
      }}>
        <Glyph name="search" size={12} />
        <span>Search / run</span>
        <span style={{ marginLeft: 12, border: "1px solid var(--rule)", padding: "0 4px", borderRadius: 2, fontSize: 10.5 }}>⌘K</span>
      </button>
      <button onClick={() => theme.toggle()} title="Toggle theme" style={{
        width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: "1px solid var(--rule)", borderRadius: 3, color: "var(--ink-2)",
      }}>
        <Glyph name={theme.mode === "dark" ? "sun" : "moon"} size={13} />
      </button>
      <a href="#/settings" title="Settings" style={{
        width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: "1px solid var(--rule)", borderRadius: 3, color: "var(--ink-2)",
      }}>
        <Glyph name="gear" size={13} />
      </a>
    </header>
  );
}
function Wordmark() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--f-serif)", fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" }}>
      <span style={{ display: "inline-block", width: 16, height: 20, background: "var(--ink)", position: "relative" }}>
        <span style={{ position: "absolute", inset: 3, background: "var(--paper)", borderLeft: "1px solid var(--ink)" }} />
      </span>
      HireScript
    </span>
  );
}
function Crumbs({ current }) {
  if (!current) return null;
  const parts = current.split(" / ");
  return (
    <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 6 }}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: "var(--rule-strong)" }}>/</span>}
          <span style={{ color: i === parts.length - 1 ? "var(--ink)" : "var(--ink-3)" }}>{p}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

// ---- Nav rail (optional left nav on library/settings) ----
function NavRail({ current }) {
  const items = [
    { href: "#/library", label: "Library", icon: "docs" },
    { href: "#/jds", label: "Job descriptions", icon: "doc" },
    { href: "#/settings", label: "Settings", icon: "gear" },
  ];
  return (
    <aside style={{
      width: 200, borderRight: "1px solid var(--rule)", padding: "14px 10px",
      display: "flex", flexDirection: "column", gap: 2, background: "var(--paper)",
      flexShrink: 0,
    }}>
      <div className="eyebrow" style={{ padding: "4px 8px 8px" }}>Workspace</div>
      {items.map(i => (
        <a key={i.href} href={i.href} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 8px", borderRadius: 3,
          color: current === i.label.toLowerCase() ? "var(--ink)" : "var(--ink-2)",
          background: current === i.label.toLowerCase() ? "var(--paper-2)" : "transparent",
          fontSize: 13,
        }}>
          <Glyph name={i.icon} size={13} />
          {i.label}
        </a>
      ))}
      <div style={{ marginTop: "auto", padding: "10px 8px", borderTop: "1px solid var(--rule)", display: "flex", alignItems: "center", gap: 8, color: "var(--ink-3)", fontSize: 12 }}>
        <span style={{ width: 22, height: 22, borderRadius: 3, background: "var(--ink)", color: "var(--paper)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--f-serif)", fontSize: 12, fontWeight: 600 }}>MO</span>
        <span style={{ color: "var(--ink-2)", fontSize: 12 }}>maya@okafor.dev</span>
      </div>
    </aside>
  );
}

// ---- Theme context ----
const ThemeCtx = createContext({ mode: "light", toggle: () => {} });
function useTheme() { return useContext(ThemeCtx); }
function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => localStorage.getItem("hs-theme") || "light");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("hs-theme", mode);
  }, [mode]);
  const toggle = () => setMode(m => m === "light" ? "dark" : "light");
  return <ThemeCtx.Provider value={{ mode, toggle }}>{children}</ThemeCtx.Provider>;
}

// ---- Hash router ----
function useHash() {
  const [hash, setHash] = useState(window.location.hash || "#/login");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/login");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

// ---- Command palette ----
function CommandPalette({ open, onClose }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { if (open) { setQ(""); setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);
  const items = useMemo(() => [
    { id: "new-variant", label: "Tailor to a new JD", hint: "Create variant", href: "#/tailor", glyph: "sparkle" },
    { id: "lib", label: "Go to Library", hint: "Navigate", href: "#/library", glyph: "docs" },
    { id: "editor", label: "Open Master in editor", hint: "Navigate", href: "#/editor/r_master", glyph: "doc" },
    { id: "editor-stripe", label: "Open Stripe variant", hint: "Navigate", href: "#/editor/r_stripe", glyph: "doc" },
    { id: "editor-linear", label: "Open Linear variant (overflow)", hint: "Navigate", href: "#/editor/r_linear", glyph: "doc" },
    { id: "diff", label: "Open diff viewer", hint: "Navigate", href: "#/diff", glyph: "sparkle" },
    { id: "history", label: "Version history", hint: "Navigate", href: "#/history", glyph: "history" },
    { id: "jds", label: "Job descriptions", hint: "Navigate", href: "#/jds", glyph: "doc" },
    { id: "settings", label: "Settings", hint: "Navigate", href: "#/settings", glyph: "gear" },
    { id: "kitchen", label: "Kitchen sink", hint: "Component library", href: "#/kitchen", glyph: "panel" },
    { id: "overflow", label: "Show 2-page overflow state", hint: "Navigate", href: "#/overflow", glyph: "warn" },
    { id: "raw", label: "Toggle raw LaTeX for current section", hint: "Editor action", glyph: "chevron-r" },
    { id: "rollback", label: "Roll back to previous version", hint: "Editor action", glyph: "undo" },
  ], []);
  const filtered = q ? items.filter(i => i.label.toLowerCase().includes(q.toLowerCase()) || i.hint.toLowerCase().includes(q.toLowerCase())) : items;
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [q]);

  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "oklch(0 0 0 / 0.25)", display: "flex", justifyContent: "center", paddingTop: "12vh" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 560, maxWidth: "92vw", background: "var(--paper)",
        border: "1px solid var(--rule-strong)", borderRadius: 4,
        boxShadow: "0 20px 60px -20px oklch(0 0 0 / 0.3)",
        display: "flex", flexDirection: "column", maxHeight: "70vh",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--rule)" }}>
          <Glyph name="search" size={14} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && filtered[idx]?.href) { location.hash = filtered[idx].href; onClose(); }
            }}
            placeholder="Jump to, tailor, roll back…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", padding: "4px 10px", fontSize: 15 }}
          />
          <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", border: "1px solid var(--rule)", padding: "1px 4px", borderRadius: 2 }}>esc</span>
        </div>
        <div style={{ overflowY: "auto", padding: 6 }}>
          {filtered.length === 0 && <div style={{ padding: 20, color: "var(--ink-3)", fontSize: 13, textAlign: "center" }}>No matches.</div>}
          {filtered.map((item, i) => (
            <a key={item.id} href={item.href || "#"} onClick={() => onClose()}
              onMouseEnter={() => setIdx(i)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: 3,
                background: i === idx ? "var(--paper-2)" : "transparent",
                color: "var(--ink)", fontSize: 13,
              }}>
              <Glyph name={item.glyph} size={13} />
              <span>{item.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--f-mono)" }}>{item.hint}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// Expose to window for cross-file access
Object.assign(window, {
  Glyph, PageCountBadge, ModelBadge, CompileChip, TermPill,
  Button, Field, Input, PDFPreview, Skeleton, Sep,
  TopChrome, NavRail, ThemeProvider, useTheme, useHash,
  CommandPalette, fmt, Wordmark,
});
