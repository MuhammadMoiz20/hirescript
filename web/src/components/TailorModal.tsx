import { useEffect, useMemo, useRef, useState } from "react";
import { api, Job } from "../api";
import Button from "./ui/Button";
import Field from "./ui/Field";
import Input from "./ui/Input";
import Glyph from "./ui/Glyph";
import ModelBadge from "./ui/ModelBadge";
import ProtectedTermPill from "./ui/ProtectedTermPill";

interface Props {
  masterId: number;
  masterName: string;
  open: boolean;
  onClose: () => void;
  onCreated: (job: Job) => void;
}

type Phase = { phase: string; message: string | null; data: any };

// Lightweight client-side keyword extraction so the JD textarea can preview
// candidate "protected" terms before the job is dispatched. The backend remains
// the source of truth for what's actually preserved during tailoring.
function extractKeywords(jd: string): string[] {
  if (jd.length < 40) return [];
  const stop = new Set([
    "the","and","for","with","you","your","our","are","this","that","from",
    "have","has","will","into","they","them","their","not","but","all","any",
    "can","may","who","what","when","where","why","how","one","two","also",
    "such","more","most","other","some","than","then","very","like","just",
    "out","new","off","per","via","each","over","about","across","within",
    "experience","required","preferred","responsibilities","qualifications",
  ]);
  const counts = new Map<string, number>();
  const tokens = jd.toLowerCase().match(/[a-z][a-z0-9+\-.]{2,}/g) || [];
  for (const t of tokens) {
    if (stop.has(t)) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);
}

export default function TailorModal({ masterId, masterName, open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [deepTailor, setDeepTailor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  function closeStream() {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }

  useEffect(() => {
    return () => closeStream();
  }, []);

  const extracted = useMemo(() => extractKeywords(jdText), [jdText]);

  if (!open) return null;

  const valid = title.trim() && company.trim() && jdText.trim();
  const charCount = jdText.length;
  const tokenEst = Math.max(0, Math.floor(jdText.length / 4));

  function reset() {
    setTitle(""); setCompany(""); setUrl(""); setJdText(""); setDeepTailor(false);
    setPhase(null); setJobId(null);
  }

  async function finishWithJob(id: string) {
    try {
      const job = await api.getJob(id);
      if (job.status === "succeeded") {
        onCreated(job);
        reset();
      } else if (job.status === "failed") {
        const r: any = job.result || {};
        if (r.error === "not_one_page") {
          setError(`Tailored resume came out at ${r.page_count} pages after ${r.iterations} repair attempts.`);
        } else {
          setError(r.error || "Tailor failed");
        }
      } else if (job.status === "cancelled") {
        setError("Tailor cancelled");
      } else {
        setError(`Unexpected job status: ${job.status}`);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to fetch job result");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError(null); setPhase(null);
    let id: string;
    try {
      const res = await api.tailorToJd(masterId, {
        title: title.trim(),
        company: company.trim(),
        url: url.trim() || undefined,
        jd_text: jdText,
        deep_tailor: deepTailor,
      });
      id = res.job_id;
      setJobId(id);
    } catch (e: any) {
      const detail = e?.detail;
      if (detail?.error === "not_one_page") setError(`Tailored resume came out at ${detail.page_count} pages after ${detail.iterations} repair attempts.`);
      else setError(e?.message || "Tailor failed");
      setBusy(false);
      return;
    }

    // Subscribe to job events SSE
    closeStream();
    const es = new EventSource(`/api/jobs/${id}/events`);
    esRef.current = es;
    es.addEventListener("phase", (ev: MessageEvent) => {
      try {
        const parsed: Phase = JSON.parse(ev.data);
        setPhase(parsed);
      } catch {
        /* ignore malformed */
      }
    });
    const handleTerminal = (status: "done" | "failed" | "cancelled") => {
      closeStream();
      if (status === "done") {
        finishWithJob(id);
      } else if (status === "cancelled") {
        setError("Tailor cancelled");
        setBusy(false);
      } else {
        finishWithJob(id);
      }
    };
    es.addEventListener("done", () => handleTerminal("done"));
    es.addEventListener("failed", () => handleTerminal("failed"));
    es.addEventListener("cancelled", () => handleTerminal("cancelled"));
    es.onerror = () => {
      if (esRef.current === es && es.readyState === EventSource.CLOSED) {
        closeStream();
        setError("Lost connection to job stream");
        setBusy(false);
      }
    };
  }

  function handleClose() {
    closeStream();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Tailor to JD"
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in oklch, var(--ink) 35%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: "var(--paper)",
          color: "var(--ink)",
          width: "100%",
          maxWidth: 720,
          maxHeight: "calc(100vh - 32px)",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--rule-strong)",
          borderRadius: 4,
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.35)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--rule)",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <div className="eyebrow">New variant</div>
            <h2
              style={{
                fontFamily: "var(--f-serif)",
                fontSize: 22,
                letterSpacing: "-0.015em",
                margin: "4px 0 4px",
              }}
            >
              Tailor "{masterName}" to a job description
            </h2>
            <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: 0 }}>
              Claude keyword-matches against your master, produces a variant, and opens the diff for review.
            </p>
          </div>
          <ModelBadge model={deepTailor ? "opus" : "sonnet"} size="sm" />
        </div>

        {/* Body */}
        <div
          style={{
            padding: "18px 20px",
            overflowY: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Company">
              <Input
                aria-label="Company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Stripe"
              />
            </Field>
            <Field label="Title">
              <Input
                aria-label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Payments Infrastructure Engineer"
              />
            </Field>
          </div>
          <Field label="Posting URL (optional)">
            <Input
              aria-label="URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </Field>

          <div>
            <div
              className="eyebrow"
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
            >
              <span>Job description</span>
              {extracted.length > 0 && (
                <span style={{ color: "var(--ok)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                  · {extracted.length} keyword{extracted.length === 1 ? "" : "s"} extracted
                </span>
              )}
            </div>
            <div
              style={{
                border: "1px solid var(--rule-strong)",
                borderRadius: 3,
                background: "var(--paper)",
              }}
            >
              <textarea
                aria-label="Job description"
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder="Paste the job description here…"
                rows={8}
                style={{
                  width: "100%",
                  minHeight: 160,
                  padding: "12px 14px",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontFamily: "var(--f-mono)",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: "var(--ink)",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
              <div
                className="mono"
                style={{
                  borderTop: "1px solid var(--rule)",
                  padding: "6px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "var(--paper-2)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                }}
              >
                <span data-testid="jd-meta">
                  {charCount.toLocaleString()} chars · ~{tokenEst} tokens
                </span>
              </div>
            </div>

            {extracted.length > 0 && (
              <div
                data-testid="jd-keywords"
                style={{
                  marginTop: 10,
                  padding: 10,
                  border: "1px solid var(--rule)",
                  borderRadius: 3,
                  background: "var(--paper-2)",
                }}
              >
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 6 }}
                >
                  Suggested protected terms from JD:
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {extracted.map((t) => (
                    <ProtectedTermPill key={t} variant="preserved">{t}</ProtectedTermPill>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Deep tailor toggle */}
          <label
            style={{
              border: "1px solid var(--rule)",
              borderRadius: 3,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={deepTailor}
              onChange={(e) => setDeepTailor(e.target.checked)}
              style={{ accentColor: "var(--ink)" }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                Deep tailor{" "}
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 400 }}>
                  · routes to Opus 4.7
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
                Slower and more expensive. Reorders bullets, rewrites for voice match, flags skill gaps.
              </div>
            </div>
            <ModelBadge model={deepTailor ? "opus" : "sonnet"} size="sm" />
          </label>

          {/* Status / errors */}
          {phase && !error && (
            <p
              role="status"
              className="mono"
              style={{
                fontSize: 12,
                color: "var(--ink-2)",
                margin: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Glyph name="dots" size={11} />
              {phase.phase}
              {phase.data?.tier ? ` (${phase.data.tier})` : ""}
            </p>
          )}
          {jobId && busy && (
            <p
              className="mono"
              style={{ color: "var(--ink-3)", fontSize: 11, margin: 0 }}
            >
              Job {jobId.slice(0, 8)}…
            </p>
          )}
          {error && (
            <p
              role="alert"
              style={{
                color: "var(--err)",
                fontSize: 12.5,
                margin: 0,
                padding: "8px 10px",
                background: "var(--err-soft)",
                border: "1px solid color-mix(in oklch, var(--err) 30%, transparent)",
                borderRadius: 3,
              }}
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--rule)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--paper)",
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-3)" }}
          >
            Creates a new variant · opens diff
          </span>
          <span style={{ flex: 1 }} />
          <Button type="button" variant="ghost" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="sparkle" disabled={!valid || busy}>
            {busy ? "Tailoring…" : "Tailor"}
          </Button>
        </div>
      </form>
    </div>
  );
}
