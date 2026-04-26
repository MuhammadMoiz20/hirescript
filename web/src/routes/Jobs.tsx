import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listJobs, cancelJob, enqueueTailorBatch, type Job, type JobStatus } from "../api";

const TERMINAL: JobStatus[] = ["succeeded", "failed", "cancelled"];

function isActive(j: Job): boolean {
  return j.status === "queued" || j.status === "running";
}

function fmtElapsed(start: string | null, end: string | null, now: number): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : now;
  const ms = Math.max(0, e - s);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}m ${r}s`;
}

function statusColor(s: JobStatus): string {
  switch (s) {
    case "running":
      return "#2563eb";
    case "queued":
      return "#6b7280";
    case "succeeded":
      return "#16a34a";
    case "failed":
      return "#dc2626";
    case "cancelled":
      return "#92400e";
    default:
      return "#6b7280";
  }
}

function StatusPill({ status }: { status: JobStatus }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: "#fff",
        background: statusColor(status),
      }}
    >
      {status}
    </span>
  );
}

export function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [searchParams] = useSearchParams();
  const highlightBatch = searchParams.get("batch");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const refresh = useCallback(async () => {
    try {
      const r = await listJobs({ limit: 50 });
      setJobs(r.items);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const anyActive = useMemo(() => jobs.some(isActive), [jobs]);

  // Poll while any job is active.
  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [anyActive, refresh]);

  // Tick "now" every second so elapsed time updates while active.
  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyActive]);

  // Scroll to highlighted batch on first load.
  useEffect(() => {
    if (!highlightBatch) return;
    const el = sectionRefs.current[highlightBatch];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlightBatch, jobs]);

  // Group jobs by batch_id (newest batch first, by max created_at).
  const groups = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of jobs) {
      const key = j.batch_id || `__solo:${j.id}`;
      const arr = map.get(key) || [];
      arr.push(j);
      map.set(key, arr);
    }
    const entries = Array.from(map.entries()).map(([key, items]) => {
      const newest = items.reduce(
        (acc, x) => (new Date(x.created_at).getTime() > acc ? new Date(x.created_at).getTime() : acc),
        0,
      );
      return { key, items, newest };
    });
    entries.sort((a, b) => b.newest - a.newest);
    return entries;
  }, [jobs]);

  const handleCancel = async (id: string) => {
    try {
      await cancelJob(id);
    } catch (e) {
      // ignore — refresh will reflect actual state
    }
    refresh();
  };

  const handleRetry = async (job: Job) => {
    const p = (job.payload || {}) as Record<string, any>;
    if (typeof p.resume_id !== "number" || typeof p.jd_text !== "string") return;
    try {
      await enqueueTailorBatch({
        resume_id: p.resume_id,
        items: [
          {
            jd_text: p.jd_text,
            title: p.title || "",
            company: p.company || "",
            url: p.url,
          },
        ],
        deep: !!p.deep,
      });
    } catch {
      // ignore — refresh shows new row
    }
    refresh();
  };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Jobs</h1>
        <Link to="/" style={{ fontSize: 14 }}>
          Back to resumes
        </Link>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}
      {!loading && !error && jobs.length === 0 && <p style={{ color: "#6b7280" }}>No jobs yet.</p>}

      {groups.map((g) => {
        const isHighlighted = highlightBatch && g.key === highlightBatch;
        return (
          <div
            key={g.key}
            ref={(el) => {
              sectionRefs.current[g.key] = el;
            }}
            style={{
              marginBottom: 24,
              border: isHighlighted ? "2px solid #2563eb" : "1px solid #e5e7eb",
              borderRadius: 8,
              background: "#fff",
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid #e5e7eb",
                fontSize: 13,
                color: "#374151",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>
                Batch <code style={{ fontSize: 12 }}>{g.key.startsWith("__solo:") ? "(single)" : g.key}</code>
              </span>
              <span style={{ color: "#6b7280" }}>{g.items.length} job{g.items.length === 1 ? "" : "s"}</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                  <th style={th}>Title</th>
                  <th style={th}>Company</th>
                  <th style={th}>Status</th>
                  <th style={th}>Elapsed</th>
                  <th style={th}>Result</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((j) => {
                  const p = (j.payload || {}) as Record<string, any>;
                  const r = (j.result || {}) as Record<string, any>;
                  const variantId = typeof r.variant_id === "number" ? r.variant_id : null;
                  const errMsg = typeof r.error === "string" ? r.error : null;
                  return (
                    <tr key={j.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={td}>{p.title || "—"}</td>
                      <td style={td}>{p.company || "—"}</td>
                      <td style={td}>
                        <StatusPill status={j.status} />
                      </td>
                      <td style={td}>{fmtElapsed(j.started_at, j.finished_at, now)}</td>
                      <td style={td}>
                        {j.status === "succeeded" && variantId !== null && (
                          <Link to={`/resumes/${variantId}`}>open variant</Link>
                        )}
                        {j.status === "failed" && errMsg && (
                          <span style={{ color: "#dc2626" }}>{errMsg}</span>
                        )}
                      </td>
                      <td style={td}>
                        {(j.status === "queued" || j.status === "running") && (
                          <button onClick={() => handleCancel(j.id)} style={btn}>
                            Cancel
                          </button>
                        )}
                        {j.status === "failed" && (
                          <button onClick={() => handleRetry(j)} style={btn}>
                            Retry
                          </button>
                        )}
                        {TERMINAL.includes(j.status) && j.status !== "failed" && (
                          <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 12px", fontWeight: 600, fontSize: 12, color: "#374151" };
const td: React.CSSProperties = { padding: "8px 12px", verticalAlign: "middle" };
const btn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  borderRadius: 4,
  cursor: "pointer",
};

export default Jobs;
