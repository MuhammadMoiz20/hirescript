import { useEffect, useState } from "react";
import { api, ResumeOut, VersionSummary } from "../api";

interface Props {
  resumeId: number;
  onRolledBack: (resume: ResumeOut) => void;
}

export default function VersionHistory({ resumeId, onRolledBack }: Props) {
  const [rows, setRows] = useState<VersionSummary[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (rows === null && !error) return <p>Loading history…</p>;

  return (
    <div aria-label="Version history">
      <h3 style={{ marginTop: 0 }}>History</h3>
      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
      {rows && rows.length === 0 && <p>No versions yet — make an edit to create one.</p>}
      <ul style={{ listStyle: "none", paddingLeft: 0 }}>
        {(rows || []).map(v => (
          <li key={v.id} style={{ borderBottom: "1px solid #eee", padding: "8px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{v.edit_source}</div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  {new Date(v.created_at).toLocaleString()}
                  {v.page_count > 0 && ` • ${v.page_count} page${v.page_count === 1 ? "" : "s"}`}
                </div>
                {v.edit_prompt && <div style={{ fontSize: 13, color: "#444" }}>{v.edit_prompt}</div>}
              </div>
              <button
                aria-label={`Rollback to v${v.id}`}
                disabled={busyId !== null}
                onClick={() => doRollback(v.id)}
              >
                {busyId === v.id ? "…" : "Rollback"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
