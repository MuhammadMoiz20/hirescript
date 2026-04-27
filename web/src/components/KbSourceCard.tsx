import { useState } from "react";
import Button from "./ui/Button";
import { KbSource } from "../api";

const SOURCE_LABELS: Record<string, string> = {
  latex_master: "Master LaTeX",
  markdown: "Manual Markdown",
  notion: "Notion",
  website: "Personal Website",
};

function humanize(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never synced";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never synced";
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `synced ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `synced ${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `synced ${hr} hour${hr === 1 ? "" : "s"} ago`;
  const d = Math.floor(hr / 24);
  return `synced ${d} day${d === 1 ? "" : "s"} ago`;
}

interface Props {
  source: KbSource;
  onSync: (source: string) => Promise<void>;
}

export default function KbSourceCard({ source, onSync }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setBusy(true);
    setError(null);
    try {
      await onSync(source.source);
    } catch (e: any) {
      setError(e?.detail ? String(e.detail) : e?.message || "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        flex: "1 1 240px",
        minWidth: 240,
        border: "1px solid var(--rule)",
        borderRadius: 4,
        padding: 14,
        background: "var(--paper)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{humanize(source.source)}</h3>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {source.source}
        </span>
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--ink-2)" }}>
        <span>
          <strong style={{ color: "var(--ink)", fontSize: 14 }}>{source.document_count}</strong> docs
        </span>
        <span>
          <strong style={{ color: "var(--ink)", fontSize: 14 }}>{source.chunk_count}</strong> chunks
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{relativeTime(source.last_synced_at)}</div>
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "var(--accent)" }}>
          {error}
        </div>
      )}
      <div style={{ marginTop: 4 }}>
        <Button size="sm" onClick={handleSync} disabled={busy}>
          {busy ? "Syncing…" : "Sync now"}
        </Button>
      </div>
    </div>
  );
}
