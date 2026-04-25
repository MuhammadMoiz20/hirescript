import { useEffect, useState } from "react";
import { api, ResumeOut, VersionSummary } from "../api";
import Button from "./ui/Button";
import Glyph from "./ui/Glyph";
import PageCountBadge from "./ui/PageCountBadge";

interface Props {
  resumeId: number;
  onRolledBack: (resume: ResumeOut) => void;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diffMs = Date.now() - t;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function VersionHistory({ resumeId, onRolledBack }: Props) {
  const [rows, setRows] = useState<VersionSummary[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);

  async function refresh() {
    try { setRows(await api.listVersions(resumeId)); }
    catch (e: any) { setError(e?.message || "Failed to load history"); }
  }
  useEffect(() => { refresh(); }, [resumeId]);

  async function doRollback(vid: number) {
    setBusyId(vid); setError(null);
    try {
      const updated = await api.rollback(resumeId, vid);
      onRolledBack(updated);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Rollback failed");
    } finally {
      setBusyId(null);
    }
  }

  if (rows === null && !error) {
    return <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading history…</p>;
  }

  return (
    <div aria-label="Version history" style={{ color: "var(--ink)" }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>Version history</div>
      <h3
        style={{
          fontFamily: "var(--f-serif)",
          fontSize: 20,
          letterSpacing: "-0.01em",
          margin: "0 0 14px",
        }}
      >
        Every edit, every compile.
      </h3>
      {error && (
        <p role="alert" style={{ color: "var(--err)", fontSize: 13 }}>{error}</p>
      )}
      {rows && rows.length === 0 && (
        <p style={{ color: "var(--ink-3)", fontSize: 13 }}>
          No versions yet — make an edit to create one.
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {(rows || []).map((v) => {
          const active = hoverId === v.id;
          return (
            <li
              key={v.id}
              onMouseEnter={() => setHoverId(v.id)}
              onMouseLeave={() => setHoverId(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderBottom: "1px solid var(--rule)",
                background: active ? "var(--paper-3, var(--paper-2))" : "transparent",
                transition: "background 80ms",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  color: "var(--ink-3)",
                  flexShrink: 0,
                }}
              >
                <Glyph name="clock" size={13} />
              </span>
              <span
                className="eyebrow"
                style={{
                  flexShrink: 0,
                  minWidth: 64,
                }}
              >
                {v.edit_source}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: v.edit_prompt ? "var(--ink)" : "var(--ink-3)",
                  fontStyle: v.edit_prompt ? "normal" : "italic",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {v.edit_prompt || "direct edit — no prompt"}
              </span>
              {v.page_count > 0 && (
                <PageCountBadge state={v.page_count as any} size="sm" />
              )}
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-3)", minWidth: 70, textAlign: "right" }}
              >
                {relativeTime(v.created_at)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon="undo"
                aria-label={`Rollback to v${v.id}`}
                disabled={busyId !== null}
                onClick={() => doRollback(v.id)}
              >
                {busyId === v.id ? "…" : "Rollback"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
