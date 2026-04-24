// HireScript — screens 6-10 + kitchen sink

const { useState: useStateB, useEffect: useEffectB, useRef: useRefB, useMemo: useMemoB } = React;

// ============================================================
// 6. TAILOR TO JD
// ============================================================
function TailorScreen() {
  const [company, setCompany] = useStateB("");
  const [title, setTitle] = useStateB("");
  const [url, setUrl] = useStateB("");
  const [jd, setJd] = useStateB("");
  const [deep, setDeep] = useStateB(false);
  const [extracted, setExtracted] = useStateB([]);
  const [extracting, setExtracting] = useStateB(false);
  const [terms, setTerms] = useStateB(window.FIXTURES.protectedTerms.slice(0, 5));
  const [newTerm, setNewTerm] = useStateB("");

  useEffectB(() => {
    if (jd.length < 40) { setExtracted([]); return; }
    setExtracting(true);
    const t = setTimeout(() => {
      setExtracted(["idempotent", "exactly-once", "p99 latency", "SOC2", "PCI-DSS", "on-call", "Postgres", "CockroachDB", "Kafka"]);
      setExtracting(false);
    }, 900);
    return () => clearTimeout(t);
  }, [jd]);

  const canSubmit = company && title && jd.length > 40;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome current="Library / Tailor to JD" onCmdK={window.__openCmd} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 32px 80px" }}>
          <div className="eyebrow">New variant</div>
          <h1 style={{ fontFamily: "var(--f-serif)", fontSize: 30, letterSpacing: "-0.02em", margin: "4px 0 8px" }}>
            Tailor to a job description
          </h1>
          <p style={{ color: "var(--ink-2)", fontSize: 14, marginBottom: 28, maxWidth: 540 }}>
            Paste the JD. Claude will keyword-match against your master, produce a variant, and open the diff for review.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Company"><Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Stripe" /></Field>
            <Field label="Role title"><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Payments Infrastructure Engineer" /></Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="Posting URL (optional)"><Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://stripe.com/jobs/listing/..." /></Field>
          </div>

          <div style={{ marginTop: 20 }}>
            <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span>JD text</span>
              {extracting && <span style={{ color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ animation: "blink 1s steps(1) infinite" }}><Glyph name="dots" size={10} /></span>Extracting keywords…</span>}
              {extracted.length > 0 && !extracting && <span style={{ color: "var(--ok)" }}>· {extracted.length} keywords extracted</span>}
            </div>
            <div style={{ border: "1px solid var(--rule-strong)", borderRadius: 3, background: "var(--paper)" }}>
              <textarea
                value={jd}
                onChange={e => setJd(e.target.value)}
                placeholder="Paste the job description here…"
                style={{
                  width: "100%", minHeight: 220, padding: "14px 16px",
                  border: "none", outline: "none", background: "transparent",
                  fontFamily: "var(--f-mono)", fontSize: 12.5, lineHeight: 1.6,
                  color: "var(--ink)", resize: "vertical",
                }}
              />
              <div style={{ borderTop: "1px solid var(--rule)", padding: "6px 12px", display: "flex", alignItems: "center", gap: 12, background: "var(--paper-2)", fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--f-mono)" }}>
                <span>{jd.length.toLocaleString()} chars · ~{Math.max(0, Math.floor(jd.length / 4))} tokens</span>
                <span style={{ flex: 1 }} />
                <button onClick={() => setJd(window.FIXTURES.jds[0].text)} style={{ color: "var(--ink-2)", textDecoration: "underline" }}>Insert sample</button>
              </div>
            </div>
          </div>

          {/* Deep tailor toggle */}
          <div style={{ marginTop: 20, border: "1px solid var(--rule)", padding: "12px 14px", borderRadius: 3, display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setDeep(!deep)} style={{
              width: 32, height: 18, borderRadius: 10,
              background: deep ? "var(--ink)" : "var(--rule-strong)",
              padding: 2, display: "inline-flex", alignItems: "center",
              transition: "background 160ms",
            }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: "var(--paper)", transform: `translateX(${deep ? 14 : 0}px)`, transition: "transform 160ms" }} />
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Deep tailor <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 400 }}>· routes to Opus 4.7</span></div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>Slower, more expensive. Reorders bullets, rewrites for voice match, and flags skill gaps.</div>
            </div>
            <ModelBadge model={deep ? "opus" : "sonnet"} size="sm" />
          </div>

          {/* Protected terms */}
          <div style={{ marginTop: 22 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Protected terms <span style={{ color: "var(--ink-3)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· Claude may not remove these</span></div>
            <div style={{ border: "1px solid var(--rule-strong)", borderRadius: 3, padding: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", minHeight: 44, background: "var(--paper)" }}>
              {terms.map(t => (
                <TermPill key={t} onRemove={() => setTerms(terms.filter(x => x !== t))}>{t}</TermPill>
              ))}
              <input
                value={newTerm}
                onChange={e => setNewTerm(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newTerm.trim()) { setTerms([...terms, newTerm.trim()]); setNewTerm(""); }
                  if (e.key === "Backspace" && !newTerm && terms.length) setTerms(terms.slice(0, -1));
                }}
                placeholder={terms.length === 0 ? "Type and hit enter…" : "add…"}
                style={{ flex: 1, minWidth: 120, border: "none", outline: "none", background: "transparent", fontSize: 12, fontFamily: "var(--f-mono)", padding: "2px 4px" }}
              />
            </div>
            {extracted.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 6 }}>Suggested from JD:</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {extracted.filter(t => !terms.includes(t)).map(t => (
                    <button key={t} onClick={() => setTerms([...terms, t])} className="mono" style={{
                      fontSize: 11, padding: "2px 7px",
                      border: "1px dashed var(--rule-strong)", borderRadius: 3,
                      color: "var(--ink-2)", background: "transparent",
                    }}>+ {t}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--rule)", display: "flex", alignItems: "center", gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
              Creates a new variant · opens diff for review
            </span>
            <span style={{ flex: 1 }} />
            <Button variant="ghost" onClick={() => history.back()}>Cancel</Button>
            <Button variant="primary" icon="sparkle" disabled={!canSubmit} onClick={() => location.hash = "#/diff"}>
              Generate variant
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 7. VERSION HISTORY
// ============================================================
function HistoryScreen() {
  const { history } = window.FIXTURES;
  const [hover, setHover] = useStateB(history[1].id);
  const hovered = history.find(h => h.id === hover) || history[0];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome current="Library / Master — Maya Okafor / History" onCmdK={window.__openCmd} autosave="2s ago" />
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 460px", overflow: "hidden" }}>
        {/* Left: list */}
        <div style={{ overflowY: "auto", padding: "22px 32px 40px" }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Version history</div>
          <h1 style={{ fontFamily: "var(--f-serif)", fontSize: 26, letterSpacing: "-0.015em", margin: "0 0 18px" }}>
            Every edit, every compile.
          </h1>

          <div className="mono" style={{
            display: "grid", gridTemplateColumns: "60px 140px 90px 1fr 120px 90px",
            gap: 14, padding: "8px 10px", fontSize: 10.5,
            color: "var(--ink-3)", letterSpacing: "0.05em", textTransform: "uppercase",
            borderBottom: "1px solid var(--rule)",
          }}>
            <span>Ver</span><span>When</span><span>Source</span><span>Prompt / note</span><span>Page count</span><span style={{ textAlign: "right" }}>Action</span>
          </div>
          {history.map(v => (
            <VersionRow key={v.id} v={v} active={hover === v.id} onHover={() => setHover(v.id)} />
          ))}
        </div>

        {/* Right: preview */}
        <div style={{ borderLeft: "1px solid var(--rule)", background: "var(--paper-2)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--rule)", background: "var(--paper)", display: "flex", alignItems: "center", gap: 10 }}>
            <Glyph name="eye" size={13} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Preview — <span className="mono" style={{ color: "var(--ink-3)" }}>{hovered.id}</span></span>
            <span style={{ flex: 1 }} />
            <PageCountBadge state={hovered.pageCount} size="sm" />
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: 18, display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
            <div style={{ transform: "scale(0.45)", transformOrigin: "top center", width: 810 * 0.45 }}>
              <div style={{ transform: "scale(1/0.45)", transformOrigin: "top center" }}>
                <PDFPreview scale={0.45} overflow={hovered.pageCount !== 1} variant={hovered.resume === "r_stripe" ? "stripe-new" : "master"} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function VersionRow({ v, active, onHover }) {
  return (
    <div
      onMouseEnter={onHover}
      onFocus={onHover}
      tabIndex={0}
      style={{
        display: "grid", gridTemplateColumns: "60px 140px 90px 1fr 120px 90px",
        gap: 14, padding: "12px 10px", alignItems: "center",
        borderBottom: "1px solid var(--rule)",
        background: active ? "var(--paper-2)" : "transparent",
        transition: "background 80ms",
        fontSize: 13,
      }}
    >
      <span className="mono" style={{ color: "var(--ink-3)", fontSize: 12 }}>{v.id}</span>
      <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>{fmt.dt(v.at)}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        {v.source === "ai" ? (
          <><Glyph name="sparkle" size={11} /> <ModelBadge model={v.model} size="sm" /></>
        ) : (
          <><Glyph name="user" size={11} /> <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>manual</span></>
        )}
      </span>
      <span style={{ color: v.prompt ? "var(--ink)" : "var(--ink-3)", fontStyle: v.prompt ? "normal" : "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
        {v.prompt || "direct edit — no prompt"}
      </span>
      <span><PageCountBadge state={v.pageCount} size="sm" /></span>
      <span style={{ textAlign: "right" }}>
        <button className="mono" style={{ fontSize: 11, padding: "3px 8px", border: "1px solid var(--rule)", borderRadius: 3, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Glyph name="undo" size={11} /> Roll back
        </button>
      </span>
    </div>
  );
}

// ============================================================
// 8. JD LIBRARY
// ============================================================
function JDsScreen() {
  const { jds } = window.FIXTURES;
  const [open, setOpen] = useStateB(jds[0].id);
  const active = jds.find(j => j.id === open);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome current="Job descriptions" onCmdK={window.__openCmd} />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <NavRail current="job descriptions" />
        <main style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 480px", overflow: "hidden" }}>
          <div style={{ padding: "24px 32px 40px", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
              <div>
                <div className="eyebrow">Saved</div>
                <h1 style={{ fontFamily: "var(--f-serif)", fontSize: 26, letterSpacing: "-0.015em", margin: "4px 0 0" }}>Job descriptions</h1>
              </div>
              <Button icon="plus" variant="primary" onClick={() => location.hash = "#/tailor"}>New JD</Button>
            </div>

            <div className="mono" style={{
              display: "grid", gridTemplateColumns: "160px 1fr 110px 90px",
              gap: 14, padding: "8px 10px", fontSize: 10.5,
              color: "var(--ink-3)", letterSpacing: "0.05em", textTransform: "uppercase",
              borderBottom: "1px solid var(--rule)",
            }}>
              <span>Company</span>
              <span>Title</span>
              <span>Added</span>
              <span style={{ textAlign: "right" }}>Variants</span>
            </div>
            {jds.map(j => (
              <button key={j.id} onClick={() => setOpen(j.id)} style={{
                display: "grid", gridTemplateColumns: "160px 1fr 110px 90px", gap: 14, alignItems: "center",
                padding: "14px 10px", borderBottom: "1px solid var(--rule)",
                background: open === j.id ? "var(--paper-2)" : "transparent",
                width: "100%", textAlign: "left", fontSize: 13,
              }}>
                <span style={{ fontWeight: 600 }}>{j.company}</span>
                <span style={{ color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title}</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>{fmt.rel(j.addedAt)}</span>
                <span className="mono" style={{ textAlign: "right", fontSize: 12, color: j.variants > 0 ? "var(--ink)" : "var(--ink-3)" }}>
                  {j.variants} {j.variants === 1 ? "variant" : "variants"}
                </span>
              </button>
            ))}
          </div>

          {/* Detail */}
          <aside style={{ borderLeft: "1px solid var(--rule)", background: "var(--paper-2)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--rule)", background: "var(--paper)" }}>
              <div className="eyebrow">Detail</div>
              <h2 style={{ fontFamily: "var(--f-serif)", fontSize: 18, margin: "4px 0 0", letterSpacing: "-0.01em" }}>{active.company} — {active.title}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <a href={active.url} className="mono" style={{ fontSize: 11, color: "var(--ink-2)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Glyph name="link" size={11} /> posting
                </a>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>· added {fmt.rel(active.addedAt)}</span>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>JD text</div>
              <pre style={{
                whiteSpace: "pre-wrap", fontFamily: "var(--f-mono)", fontSize: 12,
                color: "var(--ink-2)", margin: 0, lineHeight: 1.55,
                padding: 12, border: "1px solid var(--rule)", background: "var(--paper)", borderRadius: 3,
              }}>{active.text}</pre>

              <div className="eyebrow" style={{ marginTop: 18, marginBottom: 6 }}>Variants produced</div>
              {active.variants > 0 ? (
                <a href="#/editor/r_stripe" style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", border: "1px solid var(--rule)", borderRadius: 3, background: "var(--paper)", fontSize: 13,
                }}>
                  <Glyph name="doc" size={13} />
                  <span>Stripe — Payments Infra</span>
                  <span style={{ flex: 1 }} />
                  <PageCountBadge state={1} size="sm" />
                </a>
              ) : (
                <div style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>No variants yet.</div>
              )}
            </div>
            <div style={{ padding: 14, borderTop: "1px solid var(--rule)", background: "var(--paper)", display: "flex", gap: 8 }}>
              <Button icon="sparkle" variant="primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => location.hash = "#/tailor"}>Tailor master to this JD</Button>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}

// ============================================================
// 9. OVERFLOW STATE
// ============================================================
function OverflowScreen() {
  // Just open editor with r_linear, which is the 2-page variant.
  useEffectB(() => { location.hash = "#/editor/r_linear"; }, []);
  return null;
}

// ============================================================
// 10. SETTINGS
// ============================================================
function SettingsScreen() {
  const [terms, setTerms] = useStateB(window.FIXTURES.protectedTerms);
  const [newTerm, setNewTerm] = useStateB("");
  const [template, setTemplate] = useStateB("jakes");
  const [advanced, setAdvanced] = useStateB(false);
  const [routing, setRouting] = useStateB({ tailor: "sonnet", tighten: "haiku", deep: "opus" });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome current="Settings" onCmdK={window.__openCmd} />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <NavRail current="settings" />
        <main style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 32px 80px" }}>
            <div className="eyebrow">Workspace</div>
            <h1 style={{ fontFamily: "var(--f-serif)", fontSize: 26, letterSpacing: "-0.015em", margin: "4px 0 24px" }}>Settings</h1>

            <Section title="Password" desc="Single-tenant lock for this instance. Changing it rotates the session key.">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Current password"><Input type="password" defaultValue="supersecret" style={{ fontFamily: "var(--f-mono)" }} /></Field>
                <Field label="New password"><Input type="password" placeholder="min 12 chars" style={{ fontFamily: "var(--f-mono)" }} /></Field>
              </div>
              <div style={{ marginTop: 10 }}><Button size="sm">Update password</Button></div>
            </Section>

            <Section title="Default protected terms" desc="Applied automatically to every new variant. You can override per-variant.">
              <div style={{ border: "1px solid var(--rule-strong)", borderRadius: 3, padding: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", minHeight: 52 }}>
                {terms.map(t => <TermPill key={t} onRemove={() => setTerms(terms.filter(x => x !== t))}>{t}</TermPill>)}
                <input
                  value={newTerm}
                  onChange={e => setNewTerm(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newTerm.trim()) { setTerms([...terms, newTerm.trim()]); setNewTerm(""); } }}
                  placeholder="add term…"
                  style={{ minWidth: 120, border: "none", outline: "none", background: "transparent", fontSize: 12, fontFamily: "var(--f-mono)", padding: "2px 4px", flex: 1 }}
                />
              </div>
            </Section>

            <Section title="Default template" desc="New variants start from this template unless you pick another.">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {[
                  { id: "jakes", name: "Jake's Resume" },
                  { id: "awesome", name: "Awesome-CV" },
                  { id: "rendercv", name: "RenderCV" },
                ].map(t => (
                  <button key={t.id} onClick={() => setTemplate(t.id)} style={{
                    padding: "10px 12px", textAlign: "left",
                    border: template === t.id ? "1px solid var(--ink)" : "1px solid var(--rule)",
                    background: template === t.id ? "var(--paper-2)" : "var(--paper)",
                    borderRadius: 3,
                    display: "flex", alignItems: "center", gap: 8, fontSize: 13,
                  }}>
                    <span style={{ width: 14, height: 14, borderRadius: "50%", border: "1.5px solid var(--ink)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      {template === t.id && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ink)" }} />}
                    </span>
                    {t.name}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Model routing" desc="Advanced — override which Claude model handles each flow." collapsible collapsed={!advanced} onToggle={() => setAdvanced(!advanced)}>
              {advanced && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {[["tailor","Tailor to JD"],["tighten","Tighten / repair"],["deep","Deep tailor"]].map(([k, label]) => (
                    <div key={k} style={{ border: "1px solid var(--rule)", padding: 12, borderRadius: 3 }}>
                      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
                      <select value={routing[k]} onChange={e => setRouting({ ...routing, [k]: e.target.value })} style={{ width: "100%", padding: "5px 8px", border: "1px solid var(--rule)", borderRadius: 3, fontFamily: "var(--f-mono)", fontSize: 12 }}>
                        <option value="haiku">Haiku 4.5</option>
                        <option value="sonnet">Sonnet 4.6</option>
                        <option value="opus">Opus 4.7</option>
                      </select>
                      <div style={{ marginTop: 8 }}><ModelBadge model={routing[k]} size="sm" /></div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Compile log" desc="Recent xelatex runs. Useful when a compile error is opaque.">
              <div style={{ border: "1px solid var(--rule)", borderRadius: 3, background: "var(--paper-2)", padding: 12, fontFamily: "var(--f-mono)", fontSize: 11.5, lineHeight: 1.6, color: "var(--ink-2)", maxHeight: 180, overflowY: "auto" }}>
                <div><span style={{ color: "var(--ink-3)" }}>[10:32:14]</span> xelatex resume.tex <span style={{ color: "var(--ok)" }}>→ 1 page, 1.3s</span></div>
                <div><span style={{ color: "var(--ink-3)" }}>[10:30:51]</span> xelatex resume.tex <span style={{ color: "var(--err)" }}>→ 2 pages, 1.4s · overflow</span></div>
                <div><span style={{ color: "var(--ink-3)" }}>[10:30:08]</span> xelatex resume.tex <span style={{ color: "var(--ok)" }}>→ 1 page, 1.3s</span></div>
                <div><span style={{ color: "var(--ink-3)" }}>[10:29:44]</span> xelatex resume.tex <span style={{ color: "var(--ok)" }}>→ 1 page, 1.2s</span></div>
                <div><span style={{ color: "var(--ink-3)" }}>[10:28:02]</span> xelatex resume.tex <span style={{ color: "var(--warn)" }}>→ missing font Commit Mono — substituted JetBrains Mono</span></div>
              </div>
            </Section>
          </div>
        </main>
      </div>
    </div>
  );
}
function Section({ title, desc, children, collapsible, collapsed, onToggle }) {
  return (
    <section style={{ borderTop: "1px solid var(--rule)", padding: "20px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2 style={{ fontFamily: "var(--f-serif)", fontSize: 16, letterSpacing: "-0.005em", margin: 0, fontWeight: 500 }}>{title}</h2>
        {collapsible && (
          <button onClick={onToggle} style={{ color: "var(--ink-3)", fontSize: 11, fontFamily: "var(--f-mono)", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <Glyph name={collapsed ? "chevron-r" : "chevron-d"} size={11} /> {collapsed ? "show" : "hide"}
          </button>
        )}
      </div>
      {desc && <p style={{ color: "var(--ink-3)", fontSize: 12.5, margin: "4px 0 12px" }}>{desc}</p>}
      {children}
    </section>
  );
}

// ============================================================
// KITCHEN SINK
// ============================================================
function KitchenScreen() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome current="Kitchen sink" onCmdK={window.__openCmd} />
      <main style={{ flex: 1, overflowY: "auto", padding: "28px 40px 80px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <div className="eyebrow">Component library</div>
          <h1 style={{ fontFamily: "var(--f-serif)", fontSize: 30, letterSpacing: "-0.02em", margin: "4px 0 26px" }}>Kitchen sink</h1>

          <KSection title="Page count badge" desc="The structural signal. Used in top chrome, diff header, version rows, chat compile events, library rows.">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <PageCountBadge state={1} />
              <PageCountBadge state={2} />
              <PageCountBadge state={3} />
              <PageCountBadge state="compiling" />
              <PageCountBadge state="error" />
              <PageCountBadge state="unknown" />
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              <PageCountBadge state={1} size="sm" />
              <PageCountBadge state={2} size="sm" />
              <PageCountBadge state={1} size="lg" />
              <PageCountBadge state={2} size="lg" />
            </div>
          </KSection>

          <KSection title="Compile chip" desc="Information-dense status from every LaTeX compile. Shown inline in chat and in diff headers.">
            <div style={{ display: "flex", gap: 10, flexDirection: "column", alignItems: "flex-start" }}>
              <CompileChip model="sonnet" iterations={2} tokensCached={12840} tokensFresh={1920} wallMs={4200} pageCount={1} />
              <CompileChip model="haiku" iterations={1} tokensCached={14210} tokensFresh={620} wallMs={1300} pageCount={1} />
              <CompileChip model="opus" iterations={3} tokensCached={22100} tokensFresh={4200} wallMs={9800} pageCount={2} />
              <CompileChip kind="compiling" />
            </div>
          </KSection>

          <KSection title="Model badges" desc="Haiku / Sonnet / Opus as calm, distinct pills. Hue-coded, not shouty.">
            <div style={{ display: "flex", gap: 10 }}>
              <ModelBadge model="haiku" />
              <ModelBadge model="sonnet" />
              <ModelBadge model="opus" />
            </div>
          </KSection>

          <KSection title="Protected term pill" desc="Two variants. Preserved is quiet; removed is blocking.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <TermPill>idempotent</TermPill>
              <TermPill>exactly-once</TermPill>
              <TermPill>p99 latency</TermPill>
              <TermPill>SOC2</TermPill>
              <TermPill variant="removed">CockroachDB</TermPill>
              <TermPill variant="removed">Rust</TermPill>
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <TermPill onRemove={() => {}}>Kafka</TermPill>
              <TermPill onRemove={() => {}}>Go</TermPill>
            </div>
          </KSection>

          <KSection title="Diff line" desc="Add / remove / context. A hotspot number links to the PDF region.">
            <div style={{ border: "1px solid var(--rule)", borderRadius: 3, overflow: "hidden", background: "var(--paper)" }}>
              <DiffTable lines={window.FIXTURES.diff.lines.slice(0, 8)} />
            </div>
          </KSection>

          <KSection title="Version row" desc="Compact metadata: id, timestamp, source, prompt, page count, action.">
            <div style={{ border: "1px solid var(--rule)", borderRadius: 3, overflow: "hidden" }}>
              {window.FIXTURES.history.slice(0, 4).map(v => <VersionRow key={v.id} v={v} active={false} onHover={() => {}} />)}
            </div>
          </KSection>

          <KSection title="Buttons">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <Button variant="primary">Accept changes</Button>
              <Button>Request changes</Button>
              <Button variant="subtle">Save draft</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Override and accept anyway</Button>
              <Button disabled variant="primary">Save as final</Button>
              <Button icon="sparkle">Tailor to JD</Button>
              <Button kbd="⌘K" variant="ghost">Command palette</Button>
            </div>
          </KSection>

          <KSection title="Type" desc="Serif for headings where it reads well, sans for UI, mono for data.">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontFamily: "var(--f-serif)", fontSize: 32, letterSpacing: "-0.02em", lineHeight: 1.1 }}>Source Serif 4 — display</div>
              <div style={{ fontFamily: "var(--f-sans)", fontSize: 14 }}>Inter — body and UI label. The quick brown fox jumps over the lazy dog. 0123456789.</div>
              <div className="mono" style={{ fontSize: 12.5 }}>JetBrains Mono — 12,840 cached · 1,920 fresh · 4.2s · ✓ 1 page</div>
            </div>
          </KSection>

          <KSection title="Variant card" desc="The master card from the Library.">
            <MasterCard master={window.FIXTURES.master} />
          </KSection>
        </div>
      </main>
    </div>
  );
}
function KSection({ title, desc, children }) {
  return (
    <section style={{ marginTop: 36 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid var(--rule)" }}>
        <h2 style={{ fontFamily: "var(--f-serif)", fontSize: 18, margin: 0, fontWeight: 500 }}>{title}</h2>
        {desc && <span style={{ fontSize: 12, color: "var(--ink-3)" }}>— {desc}</span>}
      </div>
      <div style={{ padding: "6px 0" }}>{children}</div>
    </section>
  );
}

Object.assign(window, {
  TailorScreen, HistoryScreen, JDsScreen, OverflowScreen, SettingsScreen, KitchenScreen,
});
