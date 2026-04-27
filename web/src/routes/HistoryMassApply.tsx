import { useEffect, useMemo, useState } from "react";
import { api, Application } from "../api";
import TopChrome from "../components/ui/TopChrome";
import Button from "../components/ui/Button";
import Sparkline from "../components/ui/Sparkline";
import StatusPill from "../components/ui/StatusPill";

interface Props {
  onBack?: () => void;
}

const PAGE_LIMIT = 200;
const SPARK_DAYS = 14;

/**
 * HistoryMassApply — read-only archive of submitted applications.
 *
 * Source: bundle `ma-screens-1.jsx::History`.
 *
 * Renders a header with a 14-day cadence sparkline (computed client-side
 * from each application's `submitted_at` timestamp) plus a dense table of
 * past submissions. Columns: Date · Posting · R/C/A ticks · Tokens ·
 * Duration · Status pill.
 *
 * Pagination: pulls `limit=200`. If `total > 200`, a Load more button
 * fetches the next page via `offset`. Slice 2.5 keeps this client-side
 * concatenation; switching to server-side cursoring is a later concern.
 */
export default function HistoryMassApply({ onBack }: Props) {
  const [items, setItems] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadInitial() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listApplications({
        status: "submitted",
        limit: PAGE_LIMIT,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Failed to load history");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const res = await api.listApplications({
        status: "submitted",
        limit: PAGE_LIMIT,
        offset: items.length,
      });
      setItems((prev) => [...prev, ...res.items]);
      setTotal(res.total);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build a 14-day cadence from submitted_at timestamps. Bucket index 0 is
  // the oldest day (today − 13), index 13 is today. Items without a
  // submitted_at timestamp are skipped.
  const sparkData = useMemo(() => buildSparkBuckets(items, SPARK_DAYS), [items]);

  const hasMore = items.length < total;

  return (
    <div
      data-testid="history-massapply-route"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--paper)",
      }}
    >
      <TopChrome onLogoClick={onBack}>History</TopChrome>

      {/* Page header — eyebrow / title / sub + sparkline strip. */}
      <header
        style={{
          padding: "16px 20px 12px",
          background: "var(--paper)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          History
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
          Read-only application archive
        </h1>
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          Every submitted application — what was sent, where, with what model and tokens.
        </div>
      </header>

      <div
        data-testid="history-massapply-strip"
        style={{
          padding: "10px 20px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          background: "var(--paper-2)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          {loading
            ? "loading…"
            : `${items.length}${total > items.length ? ` of ${total}` : ""} application${
                items.length === 1 ? "" : "s"
              } · last ${SPARK_DAYS} days`}
        </span>
        <span
          aria-hidden
          style={{ width: 1, height: 14, background: "var(--rule)" }}
        />
        <Sparkline
          data={sparkData}
          width={200}
          height={24}
          ariaLabel={`Submitted applications over the last ${SPARK_DAYS} days`}
        />
        <div style={{ marginLeft: "auto" }}>
          <Button size="sm" variant="ghost" onClick={loadInitial} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

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
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--ink-2)",
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {loading ? (
          <div
            data-testid="history-loading"
            style={{
              padding: "48px 20px",
              textAlign: "center",
              color: "var(--ink-3)",
              fontFamily: "var(--f-mono)",
              fontSize: 12,
            }}
          >
            loading history…
          </div>
        ) : items.length === 0 ? (
          <div
            data-testid="history-empty"
            style={{
              margin: "24px 20px",
              padding: 32,
              border: "1px dashed var(--rule)",
              borderRadius: 4,
              background: "var(--paper-2)",
              textAlign: "center",
              color: "var(--ink-3)",
              fontFamily: "var(--f-mono)",
              fontSize: 12,
            }}
          >
            no submitted applications yet
          </div>
        ) : (
          <table
            data-testid="history-table"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--rule)",
                  background: "var(--paper)",
                  position: "sticky",
                  top: 0,
                }}
              >
                <Th width={140}>Date</Th>
                <Th>Posting</Th>
                <Th width={92}>Sent</Th>
                <Th width={100} align="right">
                  Tokens
                </Th>
                <Th width={92} align="right">
                  Duration
                </Th>
                <Th width={108}>Status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((app) => (
                <HistoryRow key={app.id} app={app} />
              ))}
            </tbody>
          </table>
        )}

        {hasMore && (
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              justifyContent: "center",
              borderTop: "1px solid var(--rule)",
            }}
          >
            <Button
              size="sm"
              variant="ghost"
              onClick={loadMore}
              disabled={loadingMore}
              data-testid="history-load-more"
            >
              {loadingMore
                ? "loading…"
                : `Load more (${items.length} of ${total})`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ThProps {
  children?: React.ReactNode;
  width?: number;
  align?: "left" | "right";
}

function Th({ children, width, align = "left" }: ThProps) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "8px 12px",
        fontFamily: "var(--f-mono)",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--ink-3)",
        width: width != null ? width : undefined,
      }}
    >
      {children}
    </th>
  );
}

function HistoryRow({ app }: { app: Application }) {
  const posting = app.posting;
  // TODO: backend to expose explicit R/C/A flags. For now we infer:
  //   - R (resume) is always sent for submitted applications.
  //   - C (cover letter) → ✓ if `cover_letter_text` present.
  //   - A (answers) → ✓ if `form_payload` has any keys.
  const sentR = app.status === "submitted";
  const sentC = !!app.cover_letter_text && app.cover_letter_text.length > 0;
  const sentA = !!app.form_payload && Object.keys(app.form_payload).length > 0;

  // TODO: backend to expose `tokens_used` and `duration_ms` on submitted
  // applications. Until then, surface an em dash so we don't fabricate.
  const tokens = (app as any).tokens_used as number | null | undefined;
  const durationMs = (app as any).duration_ms as number | null | undefined;

  return (
    <tr
      data-testid="history-row"
      data-application-id={app.id}
      style={{ borderBottom: "1px solid var(--rule)" }}
    >
      <td style={cellStyle()}>
        <span
          className="mono"
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11.5,
            color: "var(--ink-2)",
          }}
        >
          {fmtDate(app.submitted_at)}
        </span>
      </td>
      <td style={cellStyle()}>
        <div style={{ fontWeight: 500, color: "var(--ink)", fontSize: 13 }}>
          {posting?.title ?? "Untitled role"}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>
          {posting?.company ?? "Unknown company"}
        </div>
      </td>
      <td style={cellStyle()}>
        <div style={{ display: "flex", gap: 5 }}>
          <SentTick on={sentR} label="R" title="Resume sent" />
          <SentTick on={sentC} label="C" title="Cover letter sent" />
          <SentTick on={sentA} label="A" title="Answers sent" />
        </div>
      </td>
      <td style={cellStyle("right")}>
        <span
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11.5,
            color: "var(--ink-2)",
          }}
        >
          {tokens != null ? fmtTokens(tokens) : "—"}
        </span>
      </td>
      <td style={cellStyle("right")}>
        <span
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11.5,
            color: "var(--ink-2)",
          }}
        >
          {durationMs != null ? fmtDuration(durationMs) : "—"}
        </span>
      </td>
      <td style={cellStyle()}>
        <StatusPill status="submitted" />
      </td>
    </tr>
  );
}

function cellStyle(align: "left" | "right" = "left"): React.CSSProperties {
  return {
    padding: "10px 12px",
    textAlign: align,
    verticalAlign: "middle",
  };
}

function SentTick({
  on,
  label,
  title,
}: {
  on: boolean;
  label: string;
  title: string;
}) {
  return (
    <span
      title={title}
      data-testid={`sent-tick-${label.toLowerCase()}`}
      data-sent={on ? "true" : "false"}
      aria-label={`${title}: ${on ? "yes" : "no"}`}
      style={{
        width: 18,
        height: 18,
        display: "inline-grid",
        placeItems: "center",
        fontFamily: "var(--f-mono)",
        fontSize: 10,
        fontWeight: 600,
        color: on ? "var(--ok)" : "var(--ink-4)",
        border: `1px solid ${on ? "var(--ok)" : "var(--rule)"}`,
        background: on ? "var(--ok-soft, transparent)" : "transparent",
        borderRadius: 3,
      }}
    >
      {on ? label : "–"}
    </span>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

export function buildSparkBuckets(
  apps: Pick<Application, "submitted_at">[],
  days: number,
  now: Date = new Date(),
): number[] {
  const buckets = new Array(days).fill(0);
  // Anchor "today" to the start of the current local day so all timestamps
  // within the same calendar day fall in the same bucket.
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const a of apps) {
    if (!a.submitted_at) continue;
    const d = new Date(a.submitted_at);
    if (Number.isNaN(d.getTime())) continue;
    const submittedDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const daysAgo = Math.round((todayStart - submittedDayStart) / dayMs);
    // Bucket 0 = oldest (days−1 ago), bucket days−1 = today.
    const idx = days - 1 - daysAgo;
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Compact: YYYY-MM-DD HH:mm (UTC-naive local).
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}
