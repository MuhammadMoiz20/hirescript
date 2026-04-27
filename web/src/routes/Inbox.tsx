import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Posting, PostingDetail } from "../api";
import TopChrome from "../components/ui/TopChrome";
import Button from "../components/ui/Button";
import PostingCard from "../components/PostingCard";

interface Props {
  onBack?: () => void;
  // Test-only navigation override; falls back to react-router useNavigate.
  navigateOverride?: (path: string) => void;
}

const TIER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "dream", label: "Dream" },
  { value: "targeted", label: "Targeted" },
  { value: "wide_net", label: "Wide net" },
  { value: "skip", label: "Skip" },
];

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "ingested", label: "Ingested" },
  { value: "classified", label: "Classified" },
  { value: "preparing", label: "Preparing" },
  { value: "prepared", label: "Prepared" },
  { value: "skipped", label: "Skipped" },
  { value: "submitted", label: "Submitted" },
];

export default function Inbox({ onBack, navigateOverride }: Props) {
  const navigate = useNavigate();
  const go = navigateOverride || ((p: string) => navigate(p));

  const [postings, setPostings] = useState<Posting[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tier, setTier] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [minFit, setMinFit] = useState<string>("");
  const [maxFit, setMaxFit] = useState<string>("");

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PostingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [preparingId, setPreparingId] = useState<number | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listPostings({
        tier,
        status,
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
  }, [tier, status]);

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
    const lo = minFit ? Number(minFit) : null;
    const hi = maxFit ? Number(maxFit) : null;
    return postings.filter((p) => {
      if (q) {
        const hay = `${p.company || ""} ${p.title}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (lo != null && (p.fit_score == null || p.fit_score < lo)) return false;
      if (hi != null && (p.fit_score == null || p.fit_score > hi)) return false;
      return true;
    });
  }, [postings, search, minFit, maxFit]);

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
    setTier(undefined);
    setStatus(undefined);
    setSearch("");
    setMinFit("");
    setMaxFit("");
  }

  const hasFilters = tier || status || search || minFit || maxFit;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome onLogoClick={onBack}>Inbox</TopChrome>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Sticky filter bar */}
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              background: "var(--paper)",
              borderBottom: "1px solid var(--rule)",
              padding: "10px 14px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", gap: 4 }} role="group" aria-label="Tier filter">
              {TIER_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  aria-pressed={tier === t.value}
                  onClick={() => setTier(tier === t.value ? undefined : t.value)}
                  style={{
                    fontSize: 11.5,
                    padding: "3px 8px",
                    borderRadius: 3,
                    border: "1px solid var(--rule-strong)",
                    background: tier === t.value ? "var(--ink)" : "var(--paper)",
                    color: tier === t.value ? "var(--paper)" : "var(--ink-2)",
                    cursor: "pointer",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <select
              aria-label="Status filter"
              value={status || ""}
              onChange={(e) => setStatus(e.target.value || undefined)}
              style={{
                fontSize: 12,
                padding: "4px 6px",
                border: "1px solid var(--rule-strong)",
                background: "var(--paper)",
                color: "var(--ink)",
                borderRadius: 3,
              }}
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            <input
              type="search"
              placeholder="Search title or company"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search postings"
              style={{
                fontSize: 12,
                padding: "4px 8px",
                border: "1px solid var(--rule-strong)",
                background: "var(--paper)",
                color: "var(--ink)",
                borderRadius: 3,
                minWidth: 180,
              }}
            />

            <span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: 4 }}>Fit</span>
            <input
              type="number"
              min={0}
              max={100}
              value={minFit}
              onChange={(e) => setMinFit(e.target.value)}
              aria-label="Min fit score"
              placeholder="min"
              style={{
                fontSize: 12,
                padding: "4px 6px",
                width: 56,
                border: "1px solid var(--rule-strong)",
                background: "var(--paper)",
                color: "var(--ink)",
                borderRadius: 3,
              }}
            />
            <input
              type="number"
              min={0}
              max={100}
              value={maxFit}
              onChange={(e) => setMaxFit(e.target.value)}
              aria-label="Max fit score"
              placeholder="max"
              style={{
                fontSize: 12,
                padding: "4px 6px",
                width: 56,
                border: "1px solid var(--rule-strong)",
                background: "var(--paper)",
                color: "var(--ink)",
                borderRadius: 3,
              }}
            />

            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>Clear all</Button>
            )}

            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {loading ? "Loading…" : `${filtered.length} of ${total}`}
            </span>
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

          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading && postings.length === 0 ? (
              <div style={{ padding: 24, fontSize: 13, color: "var(--ink-3)" }}>Loading postings…</div>
            ) : filtered.length === 0 ? (
              <div
                style={{
                  margin: 24,
                  border: "1px dashed var(--rule)",
                  borderRadius: 3,
                  padding: 28,
                  textAlign: "center",
                  fontSize: 13,
                  color: "var(--ink-3)",
                }}
              >
                {postings.length === 0
                  ? "No postings yet. Greenhouse ingestion runs periodically; check back soon."
                  : "No postings match the current filters."}
              </div>
            ) : (
              filtered.map((p) => (
                <PostingCard
                  key={p.id}
                  posting={p}
                  onClick={setDrawerId}
                  onPrepare={handlePrepare}
                  onSkip={handleSkip}
                  preparing={preparingId === p.id}
                />
              ))
            )}
          </div>
        </div>

        {drawerId != null && (
          <aside
            aria-label="Posting details"
            style={{
              width: 420,
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
                onClick={() => setDrawerId(null)}
                aria-label="Close drawer"
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-2)" }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {detailLoading && !detail ? (
                <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading…</div>
              ) : detail ? (
                <div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{detail.company || "Unknown company"}</div>
                  <h2 style={{
                    fontFamily: "var(--f-serif)", margin: "2px 0 8px", fontSize: 18, letterSpacing: "-0.01em",
                  }}>
                    {detail.title}
                  </h2>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>
                    {detail.location || "—"} · {detail.source} · fit {detail.fit_score ?? "—"} · {detail.tier || "untiered"}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={preparingId === detail.id || detail.status === "preparing" || detail.status === "prepared"}
                      onClick={() => handlePrepare(detail.id)}
                    >
                      {preparingId === detail.id ? "Preparing…" : "Prepare application"}
                    </Button>
                    {detail.status !== "skipped" && (
                      <Button size="sm" variant="ghost" onClick={() => handleSkip(detail.id)}>Skip</Button>
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
                  {detail.classification_rationale && (
                    <div style={{
                      fontSize: 12,
                      color: "var(--ink-2)",
                      background: "var(--paper-2)",
                      border: "1px solid var(--rule)",
                      borderRadius: 3,
                      padding: 8,
                      marginBottom: 12,
                    }}>
                      <div className="eyebrow" style={{ marginBottom: 4 }}>Why this tier</div>
                      {detail.classification_rationale}
                    </div>
                  )}
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Description</div>
                  {detail.description_html ? (
                    <div
                      style={{ fontSize: 13, lineHeight: 1.5 }}
                      dangerouslySetInnerHTML={{ __html: detail.description_html }}
                    />
                  ) : (
                    <pre style={{
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--f-sans)",
                      fontSize: 13,
                      lineHeight: 1.5,
                      margin: 0,
                    }}>
                      {detail.description_text}
                    </pre>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No detail loaded.</div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
