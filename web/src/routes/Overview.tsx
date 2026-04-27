/**
 * Overview / home page (Suite shell pane).
 *
 * Two-column dashboard:
 *   - Left: recent resumes (per-job side) — top 5 from api.listResumes().
 *   - Right: mass-apply pulse — today's counters, expanded MaxGauge,
 *           and short previews of the inbox + queue.
 *
 * Reuses existing endpoints with small `limit` params; derives "today"
 * counters client-side. Renders inside the Suite shell — no chrome here.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Application, Posting } from "../api";
import MaxGauge from "../components/ui/MaxGauge";
import TierBadge, { Tier as TierBadgeKind } from "../components/ui/TierBadge";
import FitChip from "../components/ui/FitChip";
import StatusPill, { StatusKind } from "../components/ui/StatusPill";

type ResumeLite = {
  id: number;
  name: string;
  template_id: string;
  latex_source: string;
  updated_at: string;
};

interface Props {
  // Test-only navigation override; falls back to react-router useNavigate.
  navigateOverride?: (path: string) => void;
}

const RESUME_LIMIT = 5;
const POSTING_PREVIEW_LIMIT = 5;
const QUEUE_PREVIEW_LIMIT = 5;

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function tierToBadge(t: string | null | undefined): TierBadgeKind | null {
  if (!t) return null;
  if (t === "dream" || t === "targeted" || t === "skip") return t;
  if (t === "wide_net" || t === "wide") return "wide";
  return null;
}

const KNOWN_STATUSES: StatusKind[] = [
  "queued", "running", "ok", "failed", "cancelled",
  "paused", "stuck", "errored", "prepared", "submitted", "duplicate_skipped",
];

function asStatusKind(s: string | null | undefined): StatusKind | null {
  if (!s) return null;
  return (KNOWN_STATUSES as string[]).includes(s) ? (s as StatusKind) : null;
}

export default function Overview({ navigateOverride }: Props) {
  const navigate = useNavigate();
  const go = navigateOverride || ((p: string) => navigate(p));

  const [resumes, setResumes] = useState<ResumeLite[] | null>(null);
  const [postings, setPostings] = useState<Posting[] | null>(null);
  const [postingsTotal, setPostingsTotal] = useState(0);
  const [queue, setQueue] = useState<Application[] | null>(null);
  const [queueTotal, setQueueTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.listResumes(),
      api.listPostings({ limit: POSTING_PREVIEW_LIMIT }),
      api.listApplications({ limit: QUEUE_PREVIEW_LIMIT }),
    ])
      .then(([rs, ps, as]) => {
        if (cancelled) return;
        setResumes(rs as ResumeLite[]);
        setPostings(ps.items);
        setPostingsTotal(ps.total);
        setQueue(as.items);
        setQueueTotal(as.total);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.detail ? String(e.detail) : e?.message || "Failed to load overview");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counters = useMemo(() => {
    const postedToday = (postings || []).filter((p) => isToday(p.ingested_at)).length;
    const needsYou = (queue || []).filter(
      (a) => a.status === "prepared" || a.status === "stuck" || a.status === "errored",
    ).length;
    const submittedToday = (queue || []).filter((a) => isToday(a.submitted_at)).length;
    return { postedToday, needsYou, submittedToday };
  }, [postings, queue]);

  // TODO: wire to Max-window endpoint when Slice 3 lands.
  const placeholderUsedPct = 0;
  const placeholderResetsAt = useMemo(() => new Date(Date.now() + 5 * 60 * 60 * 1000), []);

  return (
    <div
      data-testid="overview-route"
      style={{
        height: "100%",
        overflowY: "auto",
        background: "var(--paper)",
        padding: "20px 24px",
      }}
    >
      <header style={{ marginBottom: 18 }}>
        <div className="eyebrow" style={{ color: "var(--ink-3)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          HireScript Suite
        </div>
        <h1
          style={{
            fontFamily: "var(--f-serif)",
            fontSize: 26,
            letterSpacing: "-0.01em",
            margin: "2px 0 4px",
            color: "var(--ink)",
          }}
        >
          Overview
        </h1>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
          Recent resumes on the left, mass-apply pulse on the right.
        </div>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            border: "1px solid var(--accent)",
            background: "color-mix(in oklch, var(--accent) 10%, var(--paper))",
            padding: "8px 12px",
            fontSize: 13,
            marginBottom: 14,
            borderRadius: 3,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 24,
          alignItems: "start",
        }}
      >
        {/* ── LEFT: Recent resumes ─────────────────────────────────────── */}
        <section
          aria-label="Recent resumes"
          data-testid="overview-resumes"
          style={{
            border: "1px solid var(--rule)",
            background: "var(--paper-2)",
            borderRadius: 4,
            padding: 14,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <h2
              style={{
                fontFamily: "var(--f-serif)",
                fontSize: 16,
                margin: 0,
                letterSpacing: "-0.01em",
                color: "var(--ink)",
              }}
            >
              Recent resumes
            </h2>
            <button
              onClick={() => go("/")}
              style={{
                fontSize: 12,
                color: "var(--ink-2)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Open Library →
            </button>
          </div>

          {loading && resumes === null ? (
            <SkeletonList rows={4} testid="resumes-skeleton" />
          ) : resumes && resumes.length === 0 ? (
            <EmptyHint>No resumes yet. Create one in the Library.</EmptyHint>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {(resumes || []).slice(0, RESUME_LIMIT).map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => go(`/resumes/${r.id}`)}
                    data-testid={`overview-resume-${r.id}`}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 10px",
                      border: "1px solid var(--rule)",
                      background: "var(--paper)",
                      borderRadius: 3,
                      cursor: "pointer",
                      color: "var(--ink)",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--f-serif)",
                        fontSize: 14,
                        letterSpacing: "-0.01em",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.name}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-3)", flexShrink: 0 }}
                    >
                      {fmtDate(r.updated_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── RIGHT: Mass-apply pulse ─────────────────────────────────── */}
        <section
          aria-label="Mass-apply pulse"
          data-testid="overview-massapply"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minWidth: 0,
          }}
        >
          {/* Counters + gauge card */}
          <div
            style={{
              border: "1px solid var(--rule)",
              background: "var(--paper-2)",
              borderRadius: 4,
              padding: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--f-serif)",
                  fontSize: 16,
                  margin: 0,
                  letterSpacing: "-0.01em",
                  color: "var(--ink)",
                }}
              >
                Today
              </h2>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                rolling counters
              </span>
            </div>

            {loading && postings === null && queue === null ? (
              <SkeletonList rows={2} testid="counters-skeleton" />
            ) : (
              <div
                data-testid="overview-counters"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <Counter label="Posted today" value={counters.postedToday} />
                <Counter label="Needs you" value={counters.needsYou} />
                <Counter label="Submitted today" value={counters.submittedToday} />
              </div>
            )}

            <div data-testid="overview-gauge">
              <MaxGauge
                usedPct={placeholderUsedPct}
                resetsAt={placeholderResetsAt}
                size="expanded"
              />
            </div>
          </div>

          {/* Inbox preview */}
          <div
            style={{
              border: "1px solid var(--rule)",
              background: "var(--paper-2)",
              borderRadius: 4,
              padding: 14,
            }}
            data-testid="overview-inbox"
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--f-serif)",
                  fontSize: 16,
                  margin: 0,
                  letterSpacing: "-0.01em",
                  color: "var(--ink)",
                }}
              >
                Inbox
              </h2>
              <button
                onClick={() => go("/inbox")}
                style={{
                  fontSize: 12,
                  color: "var(--ink-2)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Open inbox ({postingsTotal}) →
              </button>
            </div>

            {loading && postings === null ? (
              <SkeletonList rows={3} testid="inbox-skeleton" />
            ) : postings && postings.length === 0 ? (
              <EmptyHint>No postings yet. Greenhouse ingestion runs periodically.</EmptyHint>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {(postings || []).slice(0, POSTING_PREVIEW_LIMIT).map((p) => {
                  const tier = tierToBadge(p.tier);
                  return (
                    <li
                      key={p.id}
                      data-testid={`overview-posting-${p.id}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 8px",
                        border: "1px solid var(--rule)",
                        background: "var(--paper)",
                        borderRadius: 3,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--ink)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.title}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          {p.company || "—"}
                        </div>
                      </div>
                      {tier && <TierBadge tier={tier} />}
                      <FitChip score={p.fit_score} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Queue preview */}
          <div
            style={{
              border: "1px solid var(--rule)",
              background: "var(--paper-2)",
              borderRadius: 4,
              padding: 14,
            }}
            data-testid="overview-queue"
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--f-serif)",
                  fontSize: 16,
                  margin: 0,
                  letterSpacing: "-0.01em",
                  color: "var(--ink)",
                }}
              >
                Queue
              </h2>
              <button
                onClick={() => go("/applications")}
                style={{
                  fontSize: 12,
                  color: "var(--ink-2)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Open queue ({queueTotal}) →
              </button>
            </div>

            {loading && queue === null ? (
              <SkeletonList rows={3} testid="queue-skeleton" />
            ) : queue && queue.length === 0 ? (
              <EmptyHint>Queue is empty. Prepare a posting to start.</EmptyHint>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {(queue || []).slice(0, QUEUE_PREVIEW_LIMIT).map((a) => {
                  const status = asStatusKind(a.status);
                  return (
                    <li
                      key={a.id}
                      data-testid={`overview-application-${a.id}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 8px",
                        border: "1px solid var(--rule)",
                        background: "var(--paper)",
                        borderRadius: 3,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--ink)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {a.posting?.title || `Application #${a.id}`}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          {a.posting?.company || "—"} · mode {a.mode}
                        </div>
                      </div>
                      {status && <StatusPill status={status} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Small internal helpers ────────────────────────────────────────────────

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        background: "var(--paper)",
        borderRadius: 3,
        padding: "8px 10px",
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 22,
          color: "var(--ink)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10.5,
          color: "var(--ink-3)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed var(--rule)",
        borderRadius: 3,
        padding: "14px 12px",
        textAlign: "center",
        fontSize: 12,
        color: "var(--ink-3)",
      }}
    >
      {children}
    </div>
  );
}

function SkeletonList({ rows, testid }: { rows: number; testid?: string }) {
  return (
    <div
      data-testid={testid}
      role="status"
      aria-label="Loading"
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            height: 28,
            borderRadius: 3,
            background:
              "linear-gradient(90deg, var(--paper-3) 0%, var(--paper-2) 50%, var(--paper-3) 100%)",
            border: "1px solid var(--rule)",
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}
