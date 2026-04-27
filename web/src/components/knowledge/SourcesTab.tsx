import { useEffect, useState } from "react";
import { api, KbSource } from "../../api";
import KbSourceCard from "../KbSourceCard";

export default function SourcesTab() {
  const [sources, setSources] = useState<KbSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideMdHelp, setHideMdHelp] = useState(false);

  async function refreshSources() {
    setLoading(true);
    try {
      const s = await api.getKbSources();
      setSources(s);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Failed to load sources");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshSources();
  }, []);

  async function handleSync(source: string) {
    await api.syncKbSource(source);
    await refreshSources();
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

      <div style={{ marginBottom: 24 }}>
        <h2
          style={{
            fontFamily: "var(--f-serif)",
            fontSize: 18,
            letterSpacing: "-0.01em",
            margin: "0 0 4px",
          }}
        >
          KB ingest sources
        </h2>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink-3)" }}>
          Where the documents come from. Connect, sync, and configure scope.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {loading && sources.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading sources…</div>
          ) : (
            sources.map((s) => (
              <KbSourceCard key={s.source} source={s} onSync={handleSync} />
            ))
          )}
        </div>
      </div>

      <div>
        <h2
          style={{
            fontFamily: "var(--f-serif)",
            fontSize: 18,
            letterSpacing: "-0.01em",
            margin: "0 0 4px",
          }}
        >
          Job-source families
        </h2>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink-3)" }}>
          Connectors that feed Inbox postings (Greenhouse, Lever, Ashby, …) with ToS posture badges.
        </p>
        <div
          data-testid="job-source-families-empty"
          style={{
            border: "1px dashed var(--rule)",
            borderRadius: 3,
            padding: 20,
            textAlign: "center",
            fontSize: 13,
            color: "var(--ink-3)",
          }}
        >
          Coming in Slice 4.
        </div>
      </div>
    </div>
  );
}
