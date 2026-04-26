import { useEffect, useState } from "react";
import { api, KbDocumentItem, KbSource } from "../api";
import TopChrome from "../components/ui/TopChrome";
import Button from "../components/ui/Button";
import KbSourceCard from "../components/KbSourceCard";

interface Props {
  onBack?: () => void;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SOURCE_LABELS: Record<string, string> = {
  latex_master: "Master LaTeX",
  markdown: "Manual Markdown",
};

export default function Knowledge({ onBack }: Props) {
  const [sources, setSources] = useState<KbSource[]>([]);
  const [docs, setDocs] = useState<KbDocumentItem[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [hideMdHelp, setHideMdHelp] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  async function refreshSources() {
    setLoadingSources(true);
    try {
      const s = await api.getKbSources();
      setSources(s);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Failed to load sources");
    } finally {
      setLoadingSources(false);
    }
  }

  async function refreshDocs(source?: string) {
    setLoadingDocs(true);
    try {
      const list = await api.getKbDocuments({
        source: source && source !== "all" ? source : undefined,
        limit: 200,
      });
      setDocs(list.items);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Failed to load documents");
    } finally {
      setLoadingDocs(false);
    }
  }

  useEffect(() => {
    refreshSources();
  }, []);

  useEffect(() => {
    refreshDocs(filter);
  }, [filter]);

  async function handleSync(source: string) {
    await api.syncKbSource(source);
    await Promise.all([refreshSources(), refreshDocs(filter)]);
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try {
      await api.deleteKbDocument(id);
      await Promise.all([refreshSources(), refreshDocs(filter)]);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome onLogoClick={onBack}>Knowledge</TopChrome>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(16px, 3vw, 24px)" }}>
          <div style={{ marginBottom: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Knowledge base</div>
            <h1
              style={{
                fontFamily: "var(--f-serif)",
                fontSize: 26,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              Sources & documents
            </h1>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                border: "1px solid var(--accent)",
                background: "color-mix(in oklch, var(--accent) 10%, var(--paper))",
                color: "var(--ink)",
                padding: "8px 12px",
                borderRadius: 3,
                fontSize: 13,
                marginBottom: 14,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-2)" }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {!hideMdHelp && (
            <div
              style={{
                border: "1px dashed var(--rule-strong)",
                borderRadius: 3,
                padding: "10px 14px",
                fontSize: 12,
                color: "var(--ink-2)",
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 12,
                justifyContent: "space-between",
              }}
            >
              <span>
                Drop <code>.md</code> files into the <code>kb/</code> folder, then click Sync.
                Files are gitignored. The system reads them on every sync.
              </span>
              <button
                onClick={() => setHideMdHelp(true)}
                aria-label="Dismiss markdown helper"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--ink-3)",
                }}
              >
                ✕
              </button>
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 24,
            }}
          >
            {loadingSources && sources.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading sources…</div>
            ) : (
              sources.map((s) => (
                <KbSourceCard key={s.source} source={s} onSync={handleSync} />
              ))
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 10,
            }}
          >
            <h2
              style={{
                fontFamily: "var(--f-serif)",
                fontSize: 18,
                letterSpacing: "-0.01em",
                margin: 0,
              }}
            >
              Documents
            </h2>
            <label style={{ fontSize: 12, color: "var(--ink-3)", display: "inline-flex", gap: 6, alignItems: "center" }}>
              Source:
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter by source"
                style={{
                  border: "1px solid var(--rule-strong)",
                  background: "var(--paper)",
                  color: "var(--ink)",
                  borderRadius: 3,
                  padding: "4px 6px",
                  fontSize: 12,
                }}
              >
                <option value="all">All</option>
                <option value="latex_master">Master LaTeX</option>
                <option value="markdown">Manual Markdown</option>
              </select>
            </label>
          </div>

          {loadingDocs && docs.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading documents…</div>
          ) : docs.length === 0 ? (
            <div
              style={{
                border: "1px dashed var(--rule)",
                borderRadius: 3,
                padding: 20,
                textAlign: "center",
                fontSize: 13,
                color: "var(--ink-3)",
              }}
            >
              No documents yet. Click Sync on a source above to ingest.
            </div>
          ) : (
            <div
              style={{
                border: "1px solid var(--rule)",
                borderRadius: 3,
                background: "var(--paper)",
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--paper-2)", textAlign: "left" }}>
                    <th style={th}>Title</th>
                    <th style={th}>Source</th>
                    <th style={th}>Fetched</th>
                    <th style={{ ...th, width: 70 }}>Chunks</th>
                    <th style={{ ...th, width: 90 }} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id} style={{ borderTop: "1px solid var(--rule)" }}>
                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>{d.title || d.source_id}</div>
                        <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          {d.source_id}
                        </div>
                      </td>
                      <td style={td}>{SOURCE_LABELS[d.source] ?? d.source}</td>
                      <td style={td}>{fmtDateTime(d.fetched_at)}</td>
                      <td style={td}>{d.chunk_count}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleting === d.id}
                          onClick={() => handleDelete(d.id)}
                        >
                          {deleting === d.id ? "Deleting…" : "Delete"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "8px 12px",
  fontWeight: 500,
  fontSize: 12,
  color: "var(--ink-2)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: "1px solid var(--rule)",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  verticalAlign: "top",
};
