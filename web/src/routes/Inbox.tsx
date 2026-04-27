/**
 * Inbox — table + drawer redesign per HireScript Suite design bundle
 * (`ma-screens-1.jsx::Inbox` + `JobDrawer` + `PipelineTrace`).
 *
 * Layout:
 *   - Filter chip row (status group + tier group + source group) on top.
 *   - Sortable column header (company / tier / fit / status / source / ingested).
 *   - List of `PostingCard` rows (refactored to a row component).
 *   - Right-side drawer opens when a row is selected. Drawer contains:
 *       title + meta strip, classifier reasoning, 4-stage pipeline trace
 *       (Ingest → Classify → Tailor → Submit), and an artifacts pane.
 *
 * Backend constraints:
 *   - Uses only existing endpoints (`api.listPostings`, `api.getPosting`,
 *     `api.preparePosting`, `api.skipPosting`).
 *   - Backend doesn't yet expose per-stage timestamps, models used, or
 *     produced artifact list. The pipeline trace is derived from
 *     `posting.status` (visual stages match the bundle, deterministically
 *     marked done/current/queued). The artifacts pane shows the prepared
 *     job/batch IDs only when status implies they exist.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Posting, PostingDetail } from "../api";
import EmptyState from "../components/ui/EmptyState";
import LoadingSkeleton from "../components/ui/LoadingSkeleton";
import Button from "../components/ui/Button";
import PostingCard, { POSTING_ROW_COLUMNS } from "../components/PostingCard";
import PasteUrlDialog from "../components/PasteUrlDialog";

interface Props {
  onBack?: () => void;
  // Test-only navigation override; falls back to react-router useNavigate.
  navigateOverride?: (path: string) => void;
}

interface ChipOpt<T extends string> {
  id: T;
  label: string;
  accent?: boolean;
}

const STATUS_CHIPS: Array<ChipOpt<string>> = [
  { id: "all", label: "All" },
  { id: "needs", label: "Needs you", accent: true },
  { id: "queued", label: "In queue" },
  { id: "prepared", label: "Prepared" },
  { id: "submitted", label: "Submitted" },
  { id: "skipped", label: "Skipped" },
];

const TIER_CHIPS: Array<ChipOpt<string>> = [
  { id: "all", label: "Any tier" },
  { id: "dream", label: "Dream" },
  { id: "targeted", label: "Targeted" },
  { id: "wide_net", label: "Wide net" },
  { id: "skip", label: "Skip" },
];

// Source filter — Slice 4 wires `GET /postings?source=` server-side. Chips
// cover the five ingest sources the backend produces.
const SOURCE_ALL = "all";

const SOURCE_CHIPS: Array<ChipOpt<string>> = [
  { id: SOURCE_ALL, label: "All" },
  { id: "greenhouse", label: "Greenhouse" },
  { id: "lever", label: "Lever" },
  { id: "ashby", label: "Ashby" },
  { id: "workable", label: "Workable" },
  { id: "gmail_digest", label: "Gmail digest" },
];

// Backend statuses considered "needs you" — i.e. waiting on user action.
const NEEDS_STATUSES = new Set(["ingested", "classified"]);
const QUEUED_STATUSES = new Set(["preparing", "queued"]);

type SortKey = "ingested" | "fit" | "company" | "status";
type SortDir = "asc" | "desc";

function statusFilterMatches(filter: string, status: string): boolean {
  if (filter === "all") return true;
  if (filter === "needs") return NEEDS_STATUSES.has(status);
  if (filter === "queued") return QUEUED_STATUSES.has(status);
  if (filter === "prepared") return status === "prepared" || status === "ready";
  if (filter === "submitted") return status === "submitted";
  if (filter === "skipped") return status === "skipped";
  return true;
}

function compareBy(a: Posting, b: Posting, key: SortKey): number {
  switch (key) {
    case "ingested":
      return new Date(a.ingested_at).getTime() - new Date(b.ingested_at).getTime();
    case "fit":
      return (a.fit_score ?? -1) - (b.fit_score ?? -1);
    case "company":
      return (a.company || "").localeCompare(b.company || "");
    case "status":
      return a.status.localeCompare(b.status);
  }
}

export default function Inbox({ onBack: _onBack, navigateOverride }: Props) {
  void _onBack;
  const navigate = useNavigate();
  const go = navigateOverride || ((p: string) => navigate(p));

  const [postings, setPostings] = useState<Posting[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tier, setTier] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>(SOURCE_ALL);
  const [search, setSearch] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("ingested");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PostingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [preparingId, setPreparingId] = useState<number | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      // Server-side filters on tier and source. Status is applied
      // client-side because the chip groups (needs/queued/prepared) collapse
      // multiple backend states.
      const list = await api.listPostings({
        tier: tier !== "all" ? tier : undefined,
        source: sourceFilter !== SOURCE_ALL ? sourceFilter : undefined,
        limit: 200,
      });
      setPostings(list.items);
      setTotal(list.total);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Failed to load postings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, sourceFilter]);

  useEffect(() => {
    if (drawerId == null) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    api.getPosting(drawerId)
      .then((d) => setDetail(d))
      .catch((e: any) => setError(e?.detail ? String(e.detail) : e?.message || "Failed to load posting"))
      .finally(() => setDetailLoading(false));
  }, [drawerId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = postings.filter((p) => {
      if (!statusFilterMatches(statusFilter, p.status)) return false;
      if (q) {
        const hay = `${p.company || ""} ${p.title}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      const cmp = compareBy(a, b, sortKey);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [postings, statusFilter, search, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "ingested" || k === "fit" ? "desc" : "asc");
    }
  }

  async function handlePrepare(id: number) {
    setPreparingId(id);
    try {
      const res = await api.preparePosting(id);
      go(`/jobs?batch=${res.batch_id}`);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Prepare failed");
      setPreparingId(null);
    }
  }

  async function handleSkip(id: number) {
    try {
      await api.skipPosting(id);
      await refresh();
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Skip failed");
    }
  }

  function clearFilters() {
    setStatusFilter("all");
    setTier("all");
    setSourceFilter(SOURCE_ALL);
    setSearch("");
  }

  const hasFilters =
    statusFilter !== "all" || tier !== "all" || sourceFilter !== SOURCE_ALL || search;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Filter chip bar */}
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              background: "var(--paper)",
              borderBottom: "1px solid var(--rule)",
              padding: "12px 16px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
            }}
          >
            <ChipGroup
              label="Status filter"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_CHIPS}
            />
            <Divider />
            <ChipGroup
              label="Tier filter"
              value={tier}
              onChange={setTier}
              options={TIER_CHIPS}
            />
            <Divider />
            <ChipGroup
              label="Source filter"
              value={sourceFilter}
              onChange={setSourceFilter}
              options={SOURCE_CHIPS}
            />

            <input
              type="search"
              placeholder="Search title or company"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search postings"
              style={{
                fontSize: 12,
                padding: "5px 8px",
                border: "1px solid var(--rule)",
                background: "var(--paper)",
                color: "var(--ink)",
                borderRadius: 2,
                minWidth: 180,
              }}
            />

            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>Clear all</Button>
            )}

            <div style={{ flex: 1 }} />
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-3)" }}
            >
              {loading ? "Loading…" : `${filtered.length} of ${total}`}
            </span>
            <Button
              size="sm"
              variant="default"
              data-testid="inbox-paste-url"
              onClick={() => setPasteOpen(true)}
            >
              Paste job URL
            </Button>
            <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
              Refresh
            </Button>
          </div>

          {error && (
            <div role="alert" style={{
              border: "1px solid var(--accent)",
              background: "color-mix(in oklch, var(--accent) 10%, var(--paper))",
              padding: "8px 12px",
              fontSize: 13,
              margin: 14,
              borderRadius: 3,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}>
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                aria-label="Dismiss error"
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-2)" }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Sortable column header — sticks under the filter bar */}
          <div
            role="row"
            style={{
              display: "grid",
              gridTemplateColumns: POSTING_ROW_COLUMNS,
              alignItems: "center",
              gap: 12,
              padding: "8px 16px",
              borderBottom: "1px solid var(--rule)",
              background: "var(--paper-2)",
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            <SortHeader
              label="Company / Role"
              k="company"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={toggleSort}
            />
            <span>Tier</span>
            <SortHeader
              label="Fit"
              k="fit"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={toggleSort}
            />
            <SortHeader
              label="Status"
              k="status"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={toggleSort}
            />
            <span>Source</span>
            <SortHeader
              label="Ingested"
              k="ingested"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={toggleSort}
            />
            <span style={{ textAlign: "right" }}>Actions</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading && postings.length === 0 ? (
              <div style={{ padding: 16 }} data-testid="inbox-loading">
                <LoadingSkeleton rows={6} height={44} ariaLabel="Loading postings" />
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ margin: 24 }} data-testid="inbox-empty">
                {postings.length === 0 ? (
                  <EmptyState
                    glyph="◌"
                    title="Nothing new today"
                    body="Sources polled a few minutes ago. Greenhouse ingestion runs periodically."
                  />
                ) : (
                  <EmptyState
                    glyph="◐"
                    title="No postings match the current filters"
                    body="Loosen a status, tier, or source chip to see more."
                    variant="inline"
                  />
                )}
              </div>
            ) : (
              <>
                {filtered.map((p) => (
                  <PostingCard
                    key={p.id}
                    posting={p}
                    selected={p.id === drawerId}
                    onClick={setDrawerId}
                    onPrepare={handlePrepare}
                    onSkip={handleSkip}
                    preparing={preparingId === p.id}
                  />
                ))}
                {total > postings.length && (
                  <div style={{ padding: "12px", color: "var(--ink-3)", textAlign: "center", fontSize: 12 }}>
                    Showing first {postings.length} of {total}. Refine filters to narrow.
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <PasteUrlDialog
          open={pasteOpen}
          onClose={() => setPasteOpen(false)}
          onCreated={(p) => {
            setPasteOpen(false);
            // Insert into the head of the list so the row is visible without
            // a refetch, then auto-select the drawer for the new posting.
            setPostings((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
            setTotal((t) => t + 1);
            setDrawerId(p.id);
          }}
        />

        {drawerId != null && (
          <PostingDrawer
            detail={detail}
            loading={detailLoading}
            preparing={preparingId === drawerId}
            onClose={() => setDrawerId(null)}
            onPrepare={handlePrepare}
            onSkip={handleSkip}
          />
        )}
      </div>
    </div>
  );
}

// ─── Filter chips ────────────────────────────────────────────────────────────

function ChipGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ChipOpt<string>[];
}) {
  return (
    <div role="group" aria-label={label} style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            style={{
              padding: "4px 10px",
              background: active ? "var(--ink)" : "transparent",
              color: active ? "var(--paper)" : (o.accent ? "var(--accent)" : "var(--ink-2)"),
              border: `1px solid ${active ? "var(--ink)" : (o.accent ? "var(--accent)" : "var(--rule)")}`,
              fontFamily: "var(--f-sans)",
              fontSize: 12,
              cursor: "pointer",
              borderRadius: 2,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Divider() {
  return (
    <span aria-hidden style={{ width: 1, height: 18, background: "var(--rule)", display: "inline-block" }} />
  );
}

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <button
      type="button"
      onClick={() => onClick(k)}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color: active ? "var(--ink-2)" : "var(--ink-4)",
        fontFamily: "var(--f-mono)",
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      {label}
      <span aria-hidden style={{ fontSize: 9, opacity: active ? 1 : 0.4 }}>
        {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

function PostingDrawer({
  detail,
  loading,
  preparing,
  onClose,
  onPrepare,
  onSkip,
}: {
  detail: PostingDetail | null;
  loading: boolean;
  preparing: boolean;
  onClose: () => void;
  onPrepare: (id: number) => void;
  onSkip: (id: number) => void;
}) {
  return (
    <aside
      aria-label="Posting details"
      data-testid="posting-drawer"
      style={{
        width: 460,
        flexShrink: 0,
        borderLeft: "1px solid var(--rule)",
        background: "var(--paper)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: "1px solid var(--rule)",
      }}>
        <strong style={{ fontSize: 13 }}>Posting details</strong>
        <button
          onClick={onClose}
          aria-label="Close drawer"
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-2)" }}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && !detail ? (
          <div style={{ padding: 16, fontSize: 13, color: "var(--ink-3)" }}>Loading…</div>
        ) : !detail ? (
          <div style={{ padding: 16, fontSize: 13, color: "var(--ink-3)" }}>No detail loaded.</div>
        ) : (
          <>
            {/* Title block */}
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--rule)" }}>
              <div style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--f-mono)" }}>
                {detail.company || "Unknown company"}
              </div>
              <h2 style={{
                fontFamily: "var(--f-serif)",
                margin: "4px 0 6px",
                fontSize: 20,
                letterSpacing: "-0.01em",
              }}>
                {detail.title}
              </h2>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {detail.location || "—"} · {detail.source} · fit {detail.fit_score ?? "—"} · {detail.tier || "untiered"}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={preparing || detail.status === "preparing" || detail.status === "prepared"}
                  onClick={() => onPrepare(detail.id)}
                >
                  {preparing ? "Preparing…" : "Prepare application"}
                </Button>
                {detail.status !== "skipped" && (
                  <Button size="sm" variant="ghost" onClick={() => onSkip(detail.id)}>Skip</Button>
                )}
                <a
                  href={detail.apply_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{ fontSize: 12, color: "var(--ink-2)", alignSelf: "center" }}
                >
                  Open original ↗
                </a>
              </div>
            </div>

            {/* Why this tier — classifier reasoning */}
            <DrawerSection eyebrow="Why · classifier">
              {detail.classification_rationale ? (
                <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
                  {detail.classification_rationale}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--ink-4)", fontStyle: "italic" }}>
                  No classifier rationale recorded for this posting.
                </div>
              )}
            </DrawerSection>

            {/* 4-stage pipeline trace */}
            <DrawerSection eyebrow="Pipeline trace">
              <PipelineTrace status={detail.status} ingestedAt={detail.ingested_at} />
            </DrawerSection>

            {/* Artifacts */}
            <DrawerSection eyebrow="Artifacts">
              <ArtifactsPane status={detail.status} />
            </DrawerSection>

            {/* Description */}
            <DrawerSection eyebrow="Description" last>
              <pre style={{
                whiteSpace: "pre-wrap",
                fontFamily: "var(--f-sans)",
                fontSize: 13,
                lineHeight: 1.55,
                margin: 0,
                color: "var(--ink-2)",
              }}>
                {detail.description_text}
              </pre>
            </DrawerSection>
          </>
        )}
      </div>
    </aside>
  );
}

function DrawerSection({
  eyebrow,
  children,
  last,
}: {
  eyebrow: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div style={{ padding: "14px 18px", borderBottom: last ? "none" : "1px solid var(--rule)" }}>
      <div
        className="eyebrow"
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 10,
          letterSpacing: "0.08em",
          color: "var(--ink-4)",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {eyebrow}
      </div>
      {children}
    </div>
  );
}

// ─── Pipeline trace ──────────────────────────────────────────────────────────

type StageState = "done" | "current" | "queued" | "skipped";

interface Stage {
  id: "ingest" | "classify" | "tailor" | "submit";
  label: string;
  state: StageState;
  hint?: string;
}

// Derive the four-stage pipeline from a backend posting status. Backend
// doesn't yet emit stage timestamps so we compute deterministically from the
// posting's lifecycle. Every posting has at least the Ingest stage done.
export function deriveStages(status: string, ingestedAt: string): Stage[] {
  const ingestHint = fmtAbs(ingestedAt);

  const classifyDone =
    status === "classified" ||
    status === "preparing" ||
    status === "prepared" ||
    status === "ready" ||
    status === "submitted" ||
    status === "skipped";
  const tailorCurrent = status === "preparing";
  const tailorDone =
    status === "prepared" ||
    status === "ready" ||
    status === "submitted";
  const submitCurrent = status === "prepared" || status === "ready";
  const submitDone = status === "submitted";
  const allSkipped = status === "skipped";

  return [
    { id: "ingest", label: "Ingest", state: "done", hint: ingestHint },
    {
      id: "classify",
      label: "Classify",
      state: classifyDone ? "done" : status === "ingested" ? "current" : "queued",
      hint: classifyDone ? "haiku" : undefined,
    },
    {
      id: "tailor",
      label: "Tailor",
      state: allSkipped
        ? "skipped"
        : tailorDone
        ? "done"
        : tailorCurrent
        ? "current"
        : "queued",
      hint: tailorDone || tailorCurrent ? "sonnet" : undefined,
    },
    {
      id: "submit",
      label: "Submit",
      state: allSkipped
        ? "skipped"
        : submitDone
        ? "done"
        : submitCurrent
        ? "current"
        : "queued",
    },
  ];
}

function fmtAbs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

const STAGE_GLYPH: Record<StageState, string> = {
  done: "✓",
  current: "▶",
  queued: "○",
  skipped: "⊘",
};

const STAGE_COLOR: Record<StageState, string> = {
  done: "var(--ok)",
  current: "var(--warn)",
  queued: "var(--ink-4)",
  skipped: "var(--ink-4)",
};

const STAGE_BG: Record<StageState, string> = {
  done: "var(--paper-2)",
  current: "var(--warn-soft)",
  queued: "var(--paper)",
  skipped: "var(--paper)",
};

function PipelineTrace({ status, ingestedAt }: { status: string; ingestedAt: string }) {
  const stages = deriveStages(status, ingestedAt);
  return (
    <div
      role="list"
      aria-label="Pipeline trace"
      data-testid="pipeline-trace"
      style={{ display: "flex", alignItems: "stretch", gap: 0 }}
    >
      {stages.map((s, i) => (
        <div
          key={s.id}
          role="listitem"
          data-stage={s.id}
          data-state={s.state}
          aria-label={`${s.label} — ${s.state}`}
          style={{
            flex: 1,
            padding: "10px 12px",
            background: STAGE_BG[s.state],
            border: "1px solid var(--rule)",
            borderRight: i < stages.length - 1 ? "none" : "1px solid var(--rule)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              aria-hidden
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                color: STAGE_COLOR[s.state],
              }}
            >
              {STAGE_GLYPH[s.state]}
            </span>
            <span style={{ fontSize: 12, color: "var(--ink)", fontWeight: 500 }}>{s.label}</span>
          </div>
          {s.hint && (
            <div
              className="mono"
              style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 4 }}
            >
              {s.hint}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Artifacts pane ──────────────────────────────────────────────────────────

function ArtifactsPane({ status }: { status: string }) {
  const tailorDone =
    status === "prepared" ||
    status === "ready" ||
    status === "submitted";

  if (!tailorDone) {
    return (
      <div style={{ fontSize: 12, color: "var(--ink-4)", fontStyle: "italic" }}>
        Artifacts appear after the Tailor stage completes.
      </div>
    );
  }

  return (
    <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.7 }}>
      <ArtifactRow label="Resume" value="resume_v1.pdf" />
      <ArtifactRow label="Cover letter" value="cover_v1.pdf" />
      <ArtifactRow label="Diff" value="View diff →" />
      {status === "submitted" && (
        <ArtifactRow label="Submission" value="submitted via mode B" />
      )}
    </div>
  );
}

function ArtifactRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      padding: "4px 0",
      borderBottom: "1px solid var(--rule)",
      gap: 12,
    }}>
      <span style={{ color: "var(--ink-3)" }}>{label}</span>
      <span className="mono" style={{ fontSize: 11 }}>{value}</span>
    </div>
  );
}
