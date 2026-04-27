/**
 * Dashboard — mass-apply "today, at a glance" surface.
 *
 * Source: bundle `ma-screens-1.jsx::Dashboard`.
 *
 * Aggregates data client-side from three existing endpoints:
 *   - GET /postings        (inbox)
 *   - GET /applications    (queue + recent activity)
 *   - GET /jobs            (tailor / batch jobs — activity feed signals)
 *
 * Layout (top → bottom):
 *   1. Page header (eyebrow / title / sub).
 *   2. KPI band — 4 tiles:
 *        a. Applied · last 14 days  (sparkline + total)
 *        b. Queue                    (in-flight count, mode mix breakdown)
 *        c. Needs you                (count, lane breakdown)
 *        d. Max-window gauge         (placeholder until Slice 3)
 *   3. Tier-cap bars + Mode-mix donut/strip (B-mode 100% in Slice 2).
 *   4. Two-column: Needs-you queue (top 3) + 11-event activity feed.
 *
 * No new API endpoints. Where the backend doesn't yet expose a value
 * (per-tier daily caps, max-window usage), we render a clearly-labelled
 * TODO placeholder rather than fabricating numbers.
 */
import { useEffect, useMemo, useState } from "react";
import {
  api,
  Application,
  Job,
  listJobs,
  Posting,
} from "../api";
import MaxGauge from "../components/ui/MaxGauge";
import Sparkline from "../components/ui/Sparkline";
import StatusPill, { StatusKind } from "../components/ui/StatusPill";
import TierBadge, { Tier as TierBadgeKind } from "../components/ui/TierBadge";

interface Props {
  onBack?: () => void;
  /** Test-only navigation override. */
  navigateOverride?: (path: string) => void;
}

const SPARK_DAYS = 14;
const POSTINGS_LIMIT = 200;
const APPLICATIONS_LIMIT = 200;
const JOBS_LIMIT = 50;
const ACTIVITY_LIMIT = 11;
const NEEDS_YOU_LIMIT = 3;

// Placeholder tier caps. TODO: backend to expose per-tier daily limits.
const PLACEHOLDER_TIER_CAPS: Array<{ tier: TierBadgeKind; cap: number; label: string }> = [
  { tier: "dream", cap: 5, label: "Dream" },
  { tier: "targeted", cap: 15, label: "Targeted" },
  { tier: "wide", cap: 40, label: "Wide net" },
];

const KNOWN_STATUSES: StatusKind[] = [
  "queued",
  "running",
  "ok",
  "failed",
  "cancelled",
  "paused",
  "stuck",
  "errored",
  "prepared",
  "submitted",
  "duplicate_skipped",
];

function asStatusKind(s: string | null | undefined): StatusKind | null {
  if (!s) return null;
  return (KNOWN_STATUSES as string[]).includes(s) ? (s as StatusKind) : null;
}

function tierToBadge(t: string | null | undefined): TierBadgeKind | null {
  if (!t) return null;
  if (t === "dream" || t === "targeted" || t === "skip") return t;
  if (t === "wide_net" || t === "wide") return "wide";
  return null;
}

/** Build a 14-day cadence from submitted_at timestamps. */
export function buildAppliedSparkBuckets(
  apps: Pick<Application, "submitted_at">[],
  days: number,
  now: Date = new Date(),
): number[] {
  const buckets = new Array(days).fill(0);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const a of apps) {
    if (!a.submitted_at) continue;
    const d = new Date(a.submitted_at);
    if (Number.isNaN(d.getTime())) continue;
    const submittedDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const daysAgo = Math.round((todayStart - submittedDayStart) / dayMs);
    const idx = days - 1 - daysAgo;
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

/** Lane mapping mirrors Queue.tsx (T13). */
function laneFor(app: Application): "needs_you" | "applying" | "paused" | "b_mode" {
  if (app.status === "errored" || app.status === "stuck") return "needs_you";
  if (app.status === "running" || app.status === "submitting") return "applying";
  if (app.status === "paused") return "paused";
  return "b_mode";
}

/** Whether an application is "in flight" — anything not yet submitted/cancelled. */
function isInFlight(app: Application): boolean {
  return !(app.status === "submitted" || app.status === "cancelled");
}

type ActivityEvent = {
  id: string;
  at: string; // ISO
  kind: "submitted" | "prepared" | "ingested" | "job";
  label: string;
  sub?: string;
};

/**
 * Build a flat, time-sorted activity feed from postings/applications/jobs.
 * Rows are derived from existing timestamps — no new endpoints.
 */
export function buildActivityFeed(
  postings: Posting[],
  apps: Application[],
  jobs: Job[],
  limit: number,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const p of postings) {
    if (!p.ingested_at) continue;
    events.push({
      id: `posting-${p.id}`,
      at: p.ingested_at,
      kind: "ingested",
      label: `Ingested · ${p.title}`,
      sub: p.company || undefined,
    });
  }

  for (const a of apps) {
    if (a.submitted_at) {
      events.push({
        id: `app-submit-${a.id}`,
        at: a.submitted_at,
        kind: "submitted",
        label: `Submitted · ${a.posting?.title ?? `Application #${a.id}`}`,
        sub: a.posting?.company || undefined,
      });
    } else if (a.status === "prepared") {
      // No prepared_at on the list shape; fall back to any timestamp we have.
      // Skip if neither available — we will not fabricate a time.
    }
  }

  for (const j of jobs) {
    const at = j.finished_at || j.started_at || j.created_at;
    if (!at) continue;
    events.push({
      id: `job-${j.id}`,
      at,
      kind: "job",
      label: `${j.kind} · ${j.status}`,
    });
  }

  events.sort((a, b) => {
    const ta = new Date(a.at).getTime();
    const tb = new Date(b.at).getTime();
    return tb - ta;
  });

  return events.slice(0, limit);
}

function fmtAgo(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const day = Math.floor(h / 24);
  return `${day}d`;
}

export default function Dashboard({ navigateOverride }: Props) {
  const [postings, setPostings] = useState<Posting[] | null>(null);
  const [apps, setApps] = useState<Application[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.listPostings({ limit: POSTINGS_LIMIT }),
      api.listApplications({ limit: APPLICATIONS_LIMIT }),
      listJobs({ limit: JOBS_LIMIT }),
    ])
      .then(([ps, as, js]) => {
        if (cancelled) return;
        setPostings(ps.items);
        setApps(as.items);
        setJobs(js.items);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.detail ? String(e.detail) : e?.message || "Failed to load dashboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sparkData = useMemo(
    () => buildAppliedSparkBuckets(apps || [], SPARK_DAYS),
    [apps],
  );
  const appliedTotal = useMemo(
    () => sparkData.reduce((sum, n) => sum + n, 0),
    [sparkData],
  );

  const inFlight = useMemo(() => (apps || []).filter(isInFlight), [apps]);
  const needsYou = useMemo(
    () => (apps || []).filter((a) => laneFor(a) === "needs_you"),
    [apps],
  );
  const applying = useMemo(
    () => (apps || []).filter((a) => laneFor(a) === "applying"),
    [apps],
  );
  const paused = useMemo(
    () => (apps || []).filter((a) => laneFor(a) === "paused"),
    [apps],
  );
  const bMode = useMemo(
    () => (apps || []).filter((a) => laneFor(a) === "b_mode" && isInFlight(a)),
    [apps],
  );

  // Slice 2 is 100% B-mode by backend default. Compute mix honestly.
  const modeA = useMemo(
    () => (apps || []).filter((a) => a.mode === "A").length,
    [apps],
  );
  const modeB = useMemo(
    () => (apps || []).filter((a) => a.mode === "B").length,
    [apps],
  );

  // Per-tier "applied today" — used for the cap bars (caps themselves are
  // placeholders until backend exposes them).
  const todayKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }, []);
  const appliedTodayByTier = useMemo(() => {
    const map: Record<string, number> = { dream: 0, targeted: 0, wide: 0 };
    for (const a of apps || []) {
      if (!a.submitted_at) continue;
      const d = new Date(a.submitted_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (key !== todayKey) continue;
      const t = tierToBadge(a.posting?.tier);
      if (!t || t === "skip") continue;
      map[t] = (map[t] || 0) + 1;
    }
    return map;
  }, [apps, todayKey]);

  const activity = useMemo(
    () =>
      buildActivityFeed(
        postings || [],
        apps || [],
        jobs || [],
        ACTIVITY_LIMIT,
      ),
    [postings, apps, jobs],
  );

  const topNeedsYou = useMemo(() => needsYou.slice(0, NEEDS_YOU_LIMIT), [needsYou]);

  // TODO: wire to Max-window endpoint when Slice 3 lands.
  const placeholderUsedPct = 0;
  const placeholderResetsAt = useMemo(() => new Date(Date.now() + 5 * 60 * 60 * 1000), []);

  function go(path: string) {
    if (navigateOverride) navigateOverride(path);
  }

  return (
    <div
      data-testid="dashboard-route"
      style={{
        height: "100%",
        overflowY: "auto",
        background: "var(--paper)",
        padding: "20px 24px 32px",
      }}
    >
      <header style={{ marginBottom: 18 }}>
        <div
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          Dashboard
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
          Today, at a glance
        </h1>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
          Applied cadence, queue health, max-window headroom, and what needs you.
        </div>
      </header>

      {error && (
        <div
          role="alert"
          data-testid="dashboard-error"
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

      {/* ── KPI band ──────────────────────────────────────────────────── */}
      <section
        aria-label="KPI band"
        data-testid="dashboard-kpis"
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <KpiTile
          testid="kpi-applied"
          eyebrow="Applied · last 14 days"
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              className="mono"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 30,
                fontWeight: 600,
                color: "var(--ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {appliedTotal}
            </span>
            <span
              className="mono"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                color: "var(--ink-3)",
              }}
            >
              this period
            </span>
          </div>
          <div style={{ marginTop: 8 }} data-testid="kpi-applied-spark">
            <Sparkline
              data={sparkData}
              width={260}
              height={36}
              stroke="var(--ink)"
              fill
              ariaLabel={`Applied over the last ${SPARK_DAYS} days: ${appliedTotal} total`}
            />
          </div>
        </KpiTile>

        <KpiTile testid="kpi-queue" eyebrow="Queue">
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              className="mono"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 30,
                fontWeight: 600,
                color: "var(--ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {inFlight.length}
            </span>
            <span
              className="mono"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                color: "var(--ink-3)",
              }}
            >
              in flight
            </span>
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "10px 0 0",
              display: "flex",
              flexDirection: "column",
              gap: 3,
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            <li>
              <span style={{ color: "var(--haiku, var(--ink-2))" }}>◆</span>{" "}
              B-mode review · {bMode.length}
            </li>
            <li>
              <span style={{ color: "var(--sonnet, var(--ink-2))" }}>▶</span>{" "}
              Applying · {applying.length}
            </li>
            <li>
              <span style={{ color: "var(--warn)" }}>‖</span> Paused ·{" "}
              {paused.length}
            </li>
          </ul>
        </KpiTile>

        <KpiTile testid="kpi-needs-you" eyebrow="Needs you">
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              className="mono"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 30,
                fontWeight: 600,
                color: needsYou.length > 0 ? "var(--accent)" : "var(--ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {needsYou.length}
            </span>
            <span
              className="mono"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                color: "var(--ink-3)",
              }}
            >
              blockers
            </span>
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "10px 0 0",
              display: "flex",
              flexDirection: "column",
              gap: 3,
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            <li>
              <span style={{ color: "var(--accent)" }}>✕</span> Stuck ·{" "}
              {(apps || []).filter((a) => a.status === "stuck").length}
            </li>
            <li>
              <span style={{ color: "var(--err)" }}>!</span> Errored ·{" "}
              {(apps || []).filter((a) => a.status === "errored").length}
            </li>
          </ul>
        </KpiTile>

        <KpiTile testid="kpi-max-window" eyebrow="Max-window">
          <div data-testid="kpi-max-window-gauge" style={{ marginTop: 4 }}>
            <MaxGauge
              usedPct={placeholderUsedPct}
              resetsAt={placeholderResetsAt}
              size="expanded"
            />
          </div>
          <div
            style={{
              marginTop: 6,
              fontFamily: "var(--f-mono)",
              fontSize: 10.5,
              color: "var(--ink-4)",
            }}
          >
            TODO: wire usage when Slice 3 lands
          </div>
        </KpiTile>
      </section>

      {/* ── Tier-cap bars + Mode mix ─────────────────────────────────── */}
      <section
        aria-label="Capacity"
        data-testid="dashboard-capacity"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          marginBottom: 20,
          paddingBottom: 20,
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div data-testid="dashboard-tier-caps">
          <Eyebrow>Daily caps · by tier</Eyebrow>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              marginTop: 10,
            }}
          >
            {PLACEHOLDER_TIER_CAPS.map((row) => {
              const used = appliedTodayByTier[row.tier] || 0;
              return (
                <CapBar
                  key={row.tier}
                  tier={row.tier}
                  label={row.label}
                  used={used}
                  cap={row.cap}
                />
              );
            })}
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10.5,
                color: "var(--ink-4)",
              }}
            >
              TODO: caps are placeholders — backend has no per-tier limit yet
            </div>
          </div>
        </div>

        <div data-testid="dashboard-mode-mix">
          <Eyebrow>Mode mix · all-time</Eyebrow>
          <div
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "center",
              gap: 18,
            }}
          >
            <ModeMixDonut a={modeA} b={modeB} />
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                color: "var(--ink-3)",
                lineHeight: 1.6,
              }}
            >
              <div>
                <span style={{ color: "var(--ink)", fontWeight: 600 }}>
                  {modeA + modeB === 0
                    ? "0%"
                    : `${Math.round((modeA / (modeA + modeB)) * 100)}%`}
                </span>{" "}
                A · autonomous
              </div>
              <div>
                <span style={{ color: "var(--ink)", fontWeight: 600 }}>
                  {modeA + modeB === 0
                    ? "0%"
                    : `${Math.round((modeB / (modeA + modeB)) * 100)}%`}
                </span>{" "}
                B · reviewed
              </div>
              <div style={{ color: "var(--ink-4)", marginTop: 4 }}>
                Slice 2 defaults to B-mode
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Two-column: Needs you + Activity ─────────────────────────── */}
      <section
        aria-label="Needs you and activity"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
        }}
      >
        <div data-testid="dashboard-needs-you">
          <Eyebrow>Needs you</Eyebrow>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              marginTop: 2,
              marginBottom: 8,
            }}
          >
            Resolve these before the agent stalls
          </div>
          {loading && apps === null ? (
            <Skeleton rows={3} testid="needs-you-skeleton" />
          ) : topNeedsYou.length === 0 ? (
            <EmptyHint testid="needs-you-empty">
              Nothing blocking right now.
            </EmptyHint>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {topNeedsYou.map((a) => (
                <NeedsYouRow key={a.id} app={a} onOpen={() => go("/applications")} />
              ))}
            </ul>
          )}
        </div>

        <div data-testid="dashboard-activity">
          <Eyebrow>Activity feed</Eyebrow>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              marginTop: 2,
              marginBottom: 8,
            }}
          >
            Last {ACTIVITY_LIMIT} events · across postings, queue, and jobs
          </div>
          {loading && postings === null ? (
            <Skeleton rows={6} testid="activity-skeleton" />
          ) : activity.length === 0 ? (
            <EmptyHint testid="activity-empty">No activity yet.</EmptyHint>
          ) : (
            <ul
              data-testid="activity-list"
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {activity.map((ev) => (
                <ActivityRow key={ev.id} ev={ev} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Internal pieces ────────────────────────────────────────────────────────

function KpiTile({
  testid,
  eyebrow,
  children,
}: {
  testid: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testid}
      style={{
        border: "1px solid var(--rule)",
        background: "var(--paper-2)",
        borderRadius: 4,
        padding: 14,
        minWidth: 0,
      }}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--f-mono)",
        fontSize: 10.5,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--ink-3)",
      }}
    >
      {children}
    </div>
  );
}

function CapBar({
  tier,
  label,
  used,
  cap,
}: {
  tier: TierBadgeKind;
  label: string;
  used: number;
  cap: number;
}) {
  const pct = cap === 0 ? 0 : Math.min(100, Math.round((used / cap) * 100));
  return (
    <div data-testid={`cap-bar-${tier}`}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <TierBadge tier={tier} />
        <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{label}</span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {used} / {cap}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-label={`${label} daily cap`}
        style={{
          position: "relative",
          height: 6,
          background: "var(--paper-3)",
          border: "1px solid var(--rule)",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        <div
          data-part="fill"
          style={{
            position: "absolute",
            inset: 0,
            right: "auto",
            width: `${pct}%`,
            background: "var(--ink-2)",
          }}
        />
      </div>
    </div>
  );
}

function ModeMixDonut({ a, b }: { a: number; b: number }) {
  const total = a + b;
  const size = 64;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const aFrac = total === 0 ? 0 : a / total;
  const aLen = aFrac * c;
  const bLen = c - aLen;

  return (
    <svg
      role="img"
      data-testid="mode-mix-donut"
      data-mode-a={a}
      data-mode-b={b}
      aria-label={`Mode mix: ${a} A-mode and ${b} B-mode`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--paper-3)"
        strokeWidth={stroke}
      />
      {total > 0 && (
        <>
          {a > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={stroke}
              strokeDasharray={`${aLen} ${c - aLen}`}
              strokeDashoffset={c / 4}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )}
          {b > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--ink-3)"
              strokeWidth={stroke}
              strokeDasharray={`${bLen} ${c - bLen}`}
              strokeDashoffset={c / 4 - aLen}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )}
        </>
      )}
    </svg>
  );
}

function NeedsYouRow({
  app,
  onOpen,
}: {
  app: Application;
  onOpen: () => void;
}) {
  const status = asStatusKind(app.status);
  const tier = tierToBadge(app.posting?.tier);
  const reason =
    app.error ||
    (app.status === "stuck"
      ? "Stuck — needs intervention"
      : app.status === "errored"
        ? "Errored — review and retry"
        : "Needs review");
  return (
    <li>
      <button
        onClick={onOpen}
        data-testid={`needs-you-row-${app.id}`}
        style={{
          width: "100%",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 0",
          borderBottom: "1px solid var(--rule)",
          background: "transparent",
          border: "none",
          borderTop: "none",
          borderLeft: "none",
          borderRight: "none",
          cursor: "pointer",
          color: "var(--ink)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontWeight: 500,
                color: "var(--ink)",
                fontSize: 13,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {app.posting?.company || "Unknown company"}
            </span>
            {tier && <TierBadge tier={tier} />}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-2)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {app.posting?.title || `Application #${app.id}`}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--accent)",
              marginTop: 4,
              fontFamily: "var(--f-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            ↳ {reason}
          </div>
        </div>
        {status && <StatusPill status={status} />}
      </button>
    </li>
  );
}

const KIND_GLYPH: Record<ActivityEvent["kind"], { glyph: string; color: string }> = {
  submitted: { glyph: "✓", color: "var(--ok)" },
  prepared: { glyph: "◆", color: "var(--ink-2)" },
  ingested: { glyph: "↓", color: "var(--ink-3)" },
  job: { glyph: "▶", color: "var(--sonnet, var(--ink-2))" },
};

function ActivityRow({ ev }: { ev: ActivityEvent }) {
  const meta = KIND_GLYPH[ev.kind];
  return (
    <li
      data-testid={`activity-row-${ev.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 0",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 10,
          color: "var(--ink-4)",
          width: 28,
          flexShrink: 0,
        }}
      >
        {fmtAgo(ev.at)}
      </span>
      <span
        aria-hidden
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 11,
          color: meta.color,
          width: 14,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {meta.glyph}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--ink-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {ev.label}
        </div>
        {ev.sub && (
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {ev.sub}
          </div>
        )}
      </div>
    </li>
  );
}

function EmptyHint({
  children,
  testid,
}: {
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid}
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

function Skeleton({ rows, testid }: { rows: number; testid?: string }) {
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
