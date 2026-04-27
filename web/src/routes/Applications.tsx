import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Application } from "../api";
import TopChrome from "../components/ui/TopChrome";
import Button from "../components/ui/Button";
import ApplicationCard from "../components/ApplicationCard";

interface Props {
  onBack?: () => void;
  navigateOverride?: (path: string) => void;
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "prepared", label: "Prepared" },
  { value: "errored", label: "Errored" },
  { value: "submitting", label: "Submitting" },
  { value: "submitted", label: "Submitted" },
  { value: "all", label: "All" },
];

export default function Applications({ onBack, navigateOverride }: Props) {
  const navigate = useNavigate();
  const go = navigateOverride || ((p: string) => navigate(p));

  const [items, setItems] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("prepared");
  const [submittingId, setSubmittingId] = useState<number | null>(null);

  async function refresh(filter = statusFilter) {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listApplications({
        status: filter === "all" ? undefined : filter,
        limit: 200,
      });
      setItems(list.items);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Failed to load applications");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

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

  async function handleCancel(id: number) {
    try {
      await api.deleteApplication(id);
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Cancel failed");
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper-2)" }}>
      <TopChrome onLogoClick={onBack}>Applications</TopChrome>
      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        background: "var(--paper)",
        borderBottom: "1px solid var(--rule)",
        padding: "10px 14px",
        display: "flex",
        gap: 6,
        alignItems: "center",
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)", marginRight: 4 }}>Status</span>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            aria-pressed={statusFilter === s.value}
            onClick={() => setStatusFilter(s.value)}
            style={{
              fontSize: 11.5,
              padding: "3px 8px",
              borderRadius: 3,
              border: "1px solid var(--rule-strong)",
              background: statusFilter === s.value ? "var(--ink)" : "var(--paper)",
              color: statusFilter === s.value ? "var(--paper)" : "var(--ink-2)",
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          {loading ? "Loading…" : `${items.length} item${items.length === 1 ? "" : "s"}`}
        </span>
        <Button size="sm" variant="ghost" onClick={() => refresh()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && (
        <div role="alert" style={{
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
        }}>
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

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {loading && items.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading applications…</div>
          ) : items.length === 0 ? (
            <div style={{
              border: "1px dashed var(--rule)",
              borderRadius: 3,
              padding: 28,
              textAlign: "center",
              fontSize: 13,
              color: "var(--ink-3)",
              background: "var(--paper)",
            }}>
              No applications in this status. Prepare one from the Inbox to get started.
            </div>
          ) : (
            items.map((app) => (
              <ApplicationCard
                key={app.id}
                application={app}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                submitting={submittingId === app.id}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
