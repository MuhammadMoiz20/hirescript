import { useEffect, useRef, useState } from "react";
import { api, Job } from "../api";
import Button from "./ui/Button";
import Field from "./ui/Field";
import Input from "./ui/Input";
import Textarea from "./ui/Textarea";

interface Props {
  masterId: number;
  masterName: string;
  open: boolean;
  onClose: () => void;
  onCreated: (job: Job) => void;
}

type StepId = "keywords" | "draft" | "compile" | "repair";
type StepState = "pending" | "active" | "done";

interface StepRow {
  id: StepId;
  label: string;
  detail?: string;
  state: StepState;
  startedAt?: number;
}

type PhaseEvent = { phase: string; message: string | null; data: any };

function tierLabel(tier?: string): string {
  if (!tier) return "";
  if (tier === "haiku") return "Haiku 4.5";
  if (tier === "sonnet") return "Sonnet 4.6";
  if (tier === "opus") return "Opus 4.7";
  return tier;
}

export default function TailorModal({ masterId, masterName, open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [deepTailor, setDeepTailor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Tick the elapsed-time display while busy.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [busy]);

  const esRef = useRef<EventSource | null>(null);

  function closeStream() {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }

  // Close stream on unmount; closing the modal during a job leaves the worker running.
  useEffect(() => {
    return () => closeStream();
  }, []);

  if (!open) return null;

  const valid = title.trim() && company.trim() && jdText.trim();

  function resetSteps(deep: boolean): StepRow[] {
    return [
      { id: "keywords", label: "Extract JD keywords", state: "pending" },
      {
        id: "draft",
        label: "Draft tailored variant",
        detail: deep ? tierLabel("opus") : tierLabel("sonnet"),
        state: "pending",
      },
      { id: "compile", label: "Compile", state: "pending" },
      { id: "repair", label: "Repair if multi-page", state: "pending" },
    ];
  }

  function applyPhase(phase: PhaseEvent) {
    setSteps((prev) => {
      const next = prev.map((s) => ({ ...s }));
      const setActive = (id: StepId, detail?: string) => {
        for (const s of next) {
          if (s.id === id) {
            s.state = "active";
            s.startedAt = Date.now();
            if (detail !== undefined) s.detail = detail;
          } else if (s.state === "active") {
            s.state = "done";
          }
        }
      };
      const markDone = (id: StepId, detail?: string) => {
        for (const s of next) {
          if (s.id === id) {
            s.state = "done";
            if (detail !== undefined) s.detail = detail;
          }
        }
      };

      const data = phase.data || {};
      switch (phase.phase) {
        case "keywords_start":
          setActive("keywords");
          break;
        case "keywords_done":
          markDone("keywords", `${data.count} keyword${data.count === 1 ? "" : "s"}`);
          break;
        case "draft_start":
          setActive("draft", tierLabel(data.tier));
          break;
        case "draft_done":
          markDone("draft", `${tierLabel(next.find((s) => s.id === "draft")?.detail || "")}`.trim());
          break;
        case "compile_start":
          setActive("compile");
          break;
        case "compile_done":
          if (data.page_count === 1) {
            markDone("compile", "1 page");
          } else {
            markDone("compile", `${data.page_count} pages — repair needed`);
          }
          break;
        case "repair_start":
          setActive(
            "repair",
            `Iteration ${data.iteration} · ${tierLabel(data.tier)} · was ${data.page_count} pages`,
          );
          break;
        case "repair_compile_done":
          for (const s of next) {
            if (s.id === "repair") {
              s.detail =
                data.page_count === 1
                  ? `Iteration ${data.iteration} · 1 page`
                  : `Iteration ${data.iteration} · ${data.page_count} pages`;
            }
          }
          break;
      }
      return next;
    });
  }

  async function finishWithJob(id: string) {
    try {
      const job = await api.getJob(id);
      if (job.status === "succeeded") {
        setSteps((prev) => prev.map((s) => (s.state === "active" ? { ...s, state: "done" } : s)));
        onCreated(job);
        // Reset form on success.
        setTitle(""); setCompany(""); setUrl(""); setJdText(""); setDeepTailor(false);
        setSteps([]);
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
    setBusy(true);
    setError(null);
    setSteps(resetSteps(deepTailor));
    setNow(Date.now());

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
    } catch (e: any) {
      const detail = e?.detail;
      if (detail?.error === "not_one_page") {
        setError(`Tailored resume came out at ${detail.page_count} pages after ${detail.iterations} repair attempts.`);
      } else {
        setError(e?.message || "Tailor failed");
      }
      setBusy(false);
      return;
    }

    closeStream();
    const es = new EventSource(`/api/jobs/${id}/events`);
    esRef.current = es;
    es.addEventListener("phase", (ev: MessageEvent) => {
      try {
        const parsed: PhaseEvent = JSON.parse(ev.data);
        applyPhase(parsed);
      } catch {
        /* ignore malformed */
      }
    });
    const handleTerminal = (status: "done" | "failed" | "cancelled") => {
      closeStream();
      if (status === "cancelled") {
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

  const totalElapsed = steps.length && steps.some((s) => s.startedAt)
    ? Math.max(0, now - Math.min(...steps.filter((s) => s.startedAt).map((s) => s.startedAt!)))
    : 0;

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
        zIndex: 50,
        padding: 16,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: "var(--paper)",
          color: "var(--ink)",
          border: "1px solid var(--rule-strong)",
          borderRadius: 4,
          padding: "clamp(16px, 3vw, 24px)",
          width: "min(880px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "none",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          position: "relative",
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={handleClose}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: "transparent",
            border: "none",
            fontSize: 22,
            lineHeight: 1,
            cursor: "pointer",
            padding: 4,
            color: "var(--ink-3)",
          }}
        >
          ×
        </button>
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>New variant</div>
          <h2
            style={{
              fontFamily: "var(--f-serif)",
              fontSize: 24,
              letterSpacing: "-0.015em",
              margin: "0 0 4px",
            }}
          >
            Tailor to JD
          </h2>
          <p className="mono" style={{ fontSize: 11, color: "var(--ink-3)", margin: 0 }}>
            Generate a job-specific variant from {masterName}.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1fr) minmax(0, 1.2fr)",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Payments Infrastructure Engineer"
                disabled={busy}
              />
            </Field>
            <Field label="Company">
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Stripe"
                disabled={busy}
              />
            </Field>
            <Field label="URL">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                disabled={busy}
              />
            </Field>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <Field label="Job description">
              <Textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                rows={12}
                placeholder="Paste the job description here…"
                disabled={busy}
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  minHeight: 240,
                }}
              />
            </Field>
          </div>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            border: "1px solid var(--rule)",
            borderRadius: 3,
            padding: "10px 12px",
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={deepTailor}
            onChange={(e) => setDeepTailor(e.target.checked)}
            disabled={busy}
            style={{ accentColor: "var(--ink)" }}
          />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Deep tailor (Opus 4.7)</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
              Slower, more expensive. Reorders bullets and rewrites for voice.
            </span>
          </span>
        </label>

        {(busy || steps.length > 0) && (
          <ProgressPanel steps={steps} busy={busy} elapsedMs={totalElapsed} now={now} />
        )}

        {error && (
          <p role="alert" style={{ color: "var(--err)", fontSize: 13, margin: 0 }}>
            {error}
          </p>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            justifyContent: "flex-end",
            paddingTop: 12,
            borderTop: "1px solid var(--rule)",
          }}
        >
          <Button type="button" variant="ghost" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="sparkle"
            disabled={!valid || busy}
          >
            {busy ? "Tailoring…" : "Tailor"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function ProgressPanel({
  steps,
  busy,
  elapsedMs,
  now,
}: {
  steps: StepRow[];
  busy: boolean;
  elapsedMs: number;
  now: number;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 3,
        padding: "12px 14px",
        background: "var(--paper-2)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div className="eyebrow" style={{ color: "var(--ink-3)" }}>
          {busy ? "Working" : "Done"}
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {fmtElapsed(elapsedMs)}
        </div>
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {steps.map((s) => (
          <StepLine key={s.id} step={s} now={now} />
        ))}
      </ul>
    </div>
  );
}

function StepLine({ step, now }: { step: StepRow; now: number }) {
  const elapsed =
    step.state === "active" && step.startedAt ? now - step.startedAt : 0;
  const color =
    step.state === "done"
      ? "var(--ink)"
      : step.state === "active"
        ? "var(--ink)"
        : "var(--ink-3)";
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "16px 1fr auto",
        gap: 10,
        alignItems: "center",
        fontSize: 13,
        color,
      }}
    >
      <Indicator state={step.state} />
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span>{step.label}</span>
        {step.detail && (
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {step.detail}
          </span>
        )}
      </div>
      <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
        {step.state === "active" && elapsed > 0 ? fmtElapsed(elapsed) : ""}
      </span>
    </li>
  );
}

function Indicator({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "1px solid var(--ink)",
          background: "var(--ink)",
          color: "var(--paper)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          fontWeight: 700,
        }}
      >
        ✓
      </span>
    );
  }
  if (state === "active") {
    return (
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "1.5px solid var(--ink)",
          borderTopColor: "transparent",
          display: "inline-block",
          animation: "spin 0.9s linear infinite",
        }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "1px dashed var(--rule-strong)",
        display: "inline-block",
      }}
    />
  );
}

function fmtElapsed(ms: number): string {
  if (!ms || ms < 0) return "";
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  return `${Math.round(s)}s`;
}
