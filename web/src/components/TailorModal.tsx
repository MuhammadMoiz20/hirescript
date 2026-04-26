import { useEffect, useRef, useState } from "react";
import { api, Job } from "../api";

interface Props {
  masterId: number;
  masterName: string;
  open: boolean;
  onClose: () => void;
  onCreated: (job: Job) => void;
}

type Phase = { phase: string; message: string | null; data: any };

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

  if (!open) return null;

  const valid = title.trim() && company.trim() && jdText.trim();

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
        // failed: fetch the job to get structured error data
        finishWithJob(id);
      }
    };
    es.addEventListener("done", () => handleTerminal("done"));
    es.addEventListener("failed", () => handleTerminal("failed"));
    es.addEventListener("cancelled", () => handleTerminal("cancelled"));
    es.onerror = () => {
      // EventSource fires error on stream end; only treat as failure if no terminal received yet.
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
    <div role="dialog" aria-label="Tailor to JD" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={submit} style={{ background: "white", padding: 24, minWidth: 480, maxWidth: 640, borderRadius: 8, position: "relative" }}>
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
            fontSize: 20,
            lineHeight: 1,
            cursor: "pointer",
            padding: 4,
            color: "#666",
          }}
        >
          ×
        </button>
        <h2>Tailor "{masterName}" to a job</h2>
        <label style={{ display: "block", marginTop: 8 }}>Title <input value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label style={{ display: "block", marginTop: 8 }}>Company <input value={company} onChange={e => setCompany(e.target.value)} /></label>
        <label style={{ display: "block", marginTop: 8 }}>URL <input value={url} onChange={e => setUrl(e.target.value)} /></label>
        <label style={{ display: "block", marginTop: 8 }}>Job description
          <textarea value={jdText} onChange={e => setJdText(e.target.value)} rows={10} style={{ width: "100%" }} />
        </label>
        <label style={{ display: "block", marginTop: 8 }}>
          <input type="checkbox" checked={deepTailor} onChange={e => setDeepTailor(e.target.checked)} />
          Deep tailor (Opus 4.7)
        </label>
        {phase && !error && (
          <p role="status" style={{ color: "#555", marginTop: 8 }}>
            {phase.phase}{phase.data?.tier ? ` (${phase.data.tier})` : ""}
          </p>
        )}
        {jobId && busy && (
          <p style={{ color: "#888", fontSize: 12 }}>
            Job {jobId.slice(0, 8)}… &middot; close to run in background, watch in /jobs
          </p>
        )}
        {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={handleClose}>{busy ? "Run in background" : "Cancel"}</button>
          <button type="submit" disabled={!valid || busy}>{busy ? "Tailoring…" : "Tailor"}</button>
        </div>
      </form>
    </div>
  );
}
