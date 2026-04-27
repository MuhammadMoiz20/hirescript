import { useEffect, useState } from "react";
import { api, KbDocumentItem } from "../../api";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import LoadingSkeleton from "../ui/LoadingSkeleton";

const SOURCE_LABELS: Record<string, string> = {
  latex_master: "Master LaTeX",
  markdown: "Manual Markdown",
};

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

export default function DocumentsTab() {
  const [docs, setDocs] = useState<KbDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [deleting, setDeleting] = useState<number | null>(null);

  async function refreshDocs(source?: string) {
    setLoading(true);
    try {
      const list = await api.getKbDocuments({
        source: source && source !== "all" ? source : undefined,
        limit: 200,
      });
      setDocs(list.items);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshDocs(filter);
  }, [filter]);

  async function handleDelete(id: number) {
    setDeleting(id);
    try {
      await api.deleteKbDocument(id);
      await refreshDocs(filter);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(16px, 3vw, 24px)" }}>
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

      {loading && docs.length === 0 ? (
        <LoadingSkeleton rows={4} height={36} testid="documents-loading" ariaLabel="Loading documents" />
      ) : docs.length === 0 ? (
        <EmptyState
          glyph="◐"
          title="No KB documents yet"
          body="Connect Notion, GitHub, or paste markdown to index. Sync a source from the Sources tab to ingest."
          testid="documents-empty"
        />
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
