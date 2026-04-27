import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Application } from "../api";
import Button from "../components/ui/Button";
import QueueCard from "../components/QueueCard";

interface Props {
  onBack?: () => void;
  navigateOverride?: (path: string) => void;
}

/**
 * Queue (mass-apply) — 4-lane working surface.
 *
 * Lanes per bundle `ma-screens-1.jsx::Queue`:
 *   - Needs you   — user attention required (stuck / errored)
 *   - B-mode      — review-ready prepared B-mode applications (Slice 2 default)
 *   - Applying    — agent currently submitting (Slice 3+)
 *   - Paused      — paused on captcha / 2FA / other (Slice 3+)
 *
 * Slice 2 backend doesn't yet emit A-mode/paused/applying semantics, so the
 * Applying and Paused lanes will sit empty until Slice 3 wires those statuses.
 */

export type LaneId = "needs_you" | "b_mode" | "applying" | "paused";

interface LaneSpec {
  id: LaneId;
  title: string;
  hint: string;
  accent: string; // CSS var name fragment, e.g. "accent" → var(--accent)
}

const LANES: ReadonlyArray<LaneSpec> = [
  { id: "needs_you", title: "Needs you",   hint: "Solve before agent stalls", accent: "accent" },
  { id: "b_mode",    title: "B-mode",      hint: "Resume + cover ready",      accent: "ink" },
  { id: "applying",  title: "Applying",    hint: "Live agent steps",          accent: "sonnet" },
  { id: "paused",    title: "Paused",      hint: "Captcha · 2FA · Other",     accent: "warn" },
];

/**
 * Deterministic mapping from an Application record to a lane.
 *
 * Slice 2 backend statuses: prepared / errored / submitting / submitted / pending.
 * Lane semantics:
 *   - errored / stuck             → Needs you
 *   - submitting / running        → Applying
 *   - paused                      → Paused
 *   - prepared / B-mode default   → B-mode (everything else B-mode lands here)
 *   - submitted                   → not shown (out of queue, lives in History)
 */
export function applicationToLane(app: Application): LaneId | null {
  if (app.status === "submitted") return null;
  if (app.status === "errored" || app.status === "stuck") return "needs_you";
  if (app.status === "submitting" || app.status === "running") return "applying";
  if (app.status === "paused" || app.status === "captcha_pause") return "paused";
  // Verifier-blocked A-mode applications need user attention even though
  // their status is still "prepared".
  if (app.verify_ok === false && app.mode === "A") return "needs_you";
  // Default: B-mode review (prepared, pending, queued, anything else).
  if (app.mode === "B" || !app.mode) return "b_mode";
  // A-mode applications without a more specific status fall into Applying.
  return "applying";
}

export default function Queue({ onBack: _onBack, navigateOverride }: Props) {
  void _onBack;
  const navigate = useNavigate();
  const go = navigateOverride || ((p: string) => navigate(p));

  const [items, setItems] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [resumingAId, setResumingAId] = useState<number | null>(null);
  const [modeFilter, setModeFilter] = useState<"all" | "A" | "B">("all");
  const [verifyFilter, setVerifyFilter] = useState<"all" | "blocked">("all");

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      // Pull everything that isn't submitted; lane assignment is client-side.
      const list = await api.listApplications({ limit: 200 });
      setItems(list.items);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(id: number) {
    setSubmittingId(id);
    try {
      const res = await api.submitApplication(id);
      // Worker enqueues a submit_application job; navigate to Jobs to watch.
      go(`/jobs?job=${res.job_id}`);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Submit failed");
      setSubmittingId(null);
    }
  }

  async function handleResumeA(id: number) {
    setResumingAId(id);
    try {
      const updated = await api.promoteToA(id);
      setItems((prev) => prev.map((a) => (a.id === id ? { ...a, ...updated } : a)));
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Resume failed");
    } finally {
      setResumingAId(null);
    }
  }

  function handleEditAndRetry(id: number) {
    // Reuses the existing edit affordance — currently the per-application
    // detail page lives at /queue/:id (parent-route navigation). If/when a
    // dedicated edit URL lands, swap it in here.
    go(`/queue/${id}`);
  }

  async function handleCancel(id: number) {
    setCancellingId(id);
    try {
      await api.deleteApplication(id);
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Cancel failed");
    } finally {
      setCancellingId(null);
    }
  }

  const filteredItems = useMemo(() => {
    return items.filter((app) => {
      if (modeFilter !== "all" && app.mode !== modeFilter) return false;
      if (verifyFilter === "blocked" && app.verify_ok !== false) return false;
      return true;
    });
  }, [items, modeFilter, verifyFilter]);

  const byLane = useMemo(() => {
    const grouped: Record<LaneId, Application[]> = {
      needs_you: [],
      b_mode: [],
      applying: [],
      paused: [],
    };
    for (const app of filteredItems) {
      const lane = applicationToLane(app);
      if (lane) grouped[lane].push(app);
    }
    return grouped;
  }, [filteredItems]);

  return (
    <div
      data-testid="queue-route"
      style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper-2)" }}
    >
      {/* Page header — eyebrow + title + sub, per bundle. */}
      <header
        style={{
          padding: "16px 20px 12px",
          background: "var(--paper)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div
          className="eyebrow"
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          Queue
        </div>
        <h1
          style={{
            fontFamily: "var(--f-serif)",
            fontSize: 24,
            letterSpacing: "-0.01em",
            margin: "2px 0 4px",
            color: "var(--ink)",
          }}
        >
          The agent's working surface
        </h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", flex: 1 }}>
            What's in flight, what needs you, and what's waiting on review.
          </div>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
            {loading ? "Loading…" : `${items.length} item${items.length === 1 ? "" : "s"}`}
          </span>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        </div>

        {/* Slice 3 filters */}
        <div
          data-testid="queue-filters"
          style={{
            display: "flex",
            gap: 12,
            marginTop: 10,
            alignItems: "center",
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            mode
            <select
              aria-label="Filter by mode"
              value={modeFilter}
              onChange={(e) =>
                setModeFilter(e.target.value as "all" | "A" | "B")
              }
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                padding: "2px 6px",
                border: "1px solid var(--rule-strong)",
                background: "var(--paper)",
                color: "var(--ink)",
              }}
            >
              <option value="all">all</option>
              <option value="A">A only</option>
              <option value="B">B only</option>
            </select>
          </label>
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            verify
            <select
              aria-label="Filter by verify status"
              value={verifyFilter}
              onChange={(e) =>
                setVerifyFilter(e.target.value as "all" | "blocked")
              }
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                padding: "2px 6px",
                border: "1px solid var(--rule-strong)",
                background: "var(--paper)",
                color: "var(--ink)",
              }}
            >
              <option value="all">all</option>
              <option value="blocked">blocked only</option>
            </select>
          </label>
          {(modeFilter !== "all" || verifyFilter !== "all") && (
            <span data-testid="queue-filter-count">
              {filteredItems.length}/{items.length} shown
            </span>
          )}
        </div>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            margin: 14,
            border: "1px solid var(--accent)",
            background: "color-mix(in oklch, var(--accent) 10%, var(--paper))",
            padding: "8px 12px",
            fontSize: 13,
            borderRadius: 3,
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{error}</span>
          <button
            aria-label="Dismiss error"
            onClick={() => setError(null)}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-2)" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 4-lane grid */}
      <div
        data-testid="queue-lanes"
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          borderTop: "1px solid var(--rule)",
          minHeight: 0,
        }}
      >
        {LANES.map((lane) => (
          <Lane
            key={lane.id}
            spec={lane}
            apps={byLane[lane.id]}
            loading={loading}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            onResumeA={handleResumeA}
            onEditAndRetry={handleEditAndRetry}
            submittingId={submittingId}
            cancellingId={cancellingId}
            resumingAId={resumingAId}
          />
        ))}
      </div>
    </div>
  );
}

interface LaneProps {
  spec: LaneSpec;
  apps: Application[];
  loading: boolean;
  onSubmit: (id: number) => void;
  onCancel: (id: number) => void;
  onResumeA: (id: number) => void;
  onEditAndRetry: (id: number) => void;
  submittingId: number | null;
  cancellingId: number | null;
  resumingAId: number | null;
}

function Lane({
  spec,
  apps,
  loading,
  onSubmit,
  onCancel,
  onResumeA,
  onEditAndRetry,
  submittingId,
  cancellingId,
  resumingAId,
}: LaneProps) {
  const futureLane = spec.id === "applying" || spec.id === "paused";
  const emptyText = futureLane && apps.length === 0
    ? "Coming in Slice 3"
    : "nothing here";

  return (
    <section
      data-testid={`queue-lane-${spec.id}`}
      data-lane-id={spec.id}
      aria-label={`${spec.title} lane`}
      style={{
        borderRight: "1px solid var(--rule)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        background: "var(--paper-2)",
      }}
    >
      <header
        style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid var(--rule)",
          background: "var(--paper)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: 6,
              background: `var(--${spec.accent})`,
              display: "inline-block",
            }}
          />
          <h2
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink)",
            }}
          >
            {spec.title}
          </h2>
          <span
            data-testid={`queue-lane-count-${spec.id}`}
            className="mono"
            style={{
              marginLeft: "auto",
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            {apps.length}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{spec.hint}</div>
      </header>

      <div
        style={{
          flex: 1,
          padding: 10,
          overflowY: "auto",
          minHeight: 0,
        }}
      >
        {loading && apps.length === 0 ? (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              padding: 24,
              color: "var(--ink-3)",
              fontFamily: "var(--f-mono)",
              fontSize: 11,
            }}
          >
            loading…
          </div>
        ) : apps.length === 0 ? (
          <div
            data-testid={`queue-lane-empty-${spec.id}`}
            style={{
              display: "grid",
              placeItems: "center",
              padding: 24,
              color: "var(--ink-3)",
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              border: "1px dashed var(--rule)",
              background: "var(--paper)",
              borderRadius: 3,
            }}
          >
            {emptyText}
          </div>
        ) : (
          apps.map((app) => (
            <QueueCard
              key={app.id}
              application={app}
              onSubmit={onSubmit}
              onCancel={onCancel}
              onResumeA={onResumeA}
              onEditAndRetry={onEditAndRetry}
              submitting={submittingId === app.id}
              cancelling={cancellingId === app.id}
              resumingA={resumingAId === app.id}
            />
          ))
        )}
      </div>
    </section>
  );
}
