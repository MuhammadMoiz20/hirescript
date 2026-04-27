import { diffLines } from "diff";
import Button from "./ui/Button";
import PageCountBadge from "./ui/PageCountBadge";
import ProtectedTermPill from "./ui/ProtectedTermPill";
import Glyph from "./ui/Glyph";

interface Props {
  currentLatex: string;
  proposedLatex: string;
  pageCount: number;
  enforced: boolean;
  removedTerms: string[];
  onAccept: () => void;
  onReject: () => void;
  busy?: boolean;
  iterations?: number;
}

type RowType = "context" | "added" | "removed";
interface Row {
  type: RowType;
  left: string | null;
  right: string | null;
  leftNo: number | null;
  rightNo: number | null;
}

function buildRows(current: string, proposed: string): Row[] {
  const hunks = diffLines(current, proposed);
  const rows: Row[] = [];
  let leftNo = 1;
  let rightNo = 1;
  for (const hunk of hunks) {
    const lines = hunk.value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (hunk.added) {
      for (const line of lines) {
        rows.push({ type: "added", left: null, right: line, leftNo: null, rightNo: rightNo++ });
      }
    } else if (hunk.removed) {
      for (const line of lines) {
        rows.push({ type: "removed", left: line, right: null, leftNo: leftNo++, rightNo: null });
      }
    } else {
      for (const line of lines) {
        rows.push({ type: "context", left: line, right: line, leftNo: leftNo++, rightNo: rightNo++ });
      }
    }
  }
  return rows;
}

export default function DiffView({
  currentLatex,
  proposedLatex,
  pageCount,
  enforced,
  removedTerms,
  onAccept,
  onReject,
  busy = false,
  iterations,
}: Props) {
  const rows = buildRows(currentLatex, proposedLatex);
  const acceptDisabled = !enforced || busy;
  const addedCount = rows.filter(r => r.type === "added").length;
  const removedCount = rows.filter(r => r.type === "removed").length;

  const cellBase: React.CSSProperties = {
    padding: "1px 8px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: "var(--f-mono)",
    fontSize: 12.5,
    lineHeight: 1.6,
    color: "var(--ink)",
    minHeight: "1.6em",
  };
  const numStyle: React.CSSProperties = {
    color: "var(--ink-4, var(--ink-3))",
    fontSize: 10.5,
    fontFamily: "var(--f-mono)",
    textAlign: "right",
    padding: "1px 8px",
    userSelect: "none",
    minHeight: "1.6em",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minWidth: 0,
        background: "var(--paper)",
      }}
    >
      {/* Header strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid var(--rule)",
          background: "var(--paper)",
        }}
      >
        <PageCountBadge state={enforced ? "ok" : (pageCount as number)} size="sm" />
        {typeof iterations === "number" && (
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-3)" }}
          >
            iter {iterations}
          </span>
        )}
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--err)" }}
        >
          −{removedCount}
        </span>
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--ok)" }}
        >
          +{addedCount}
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onReject} disabled={busy} aria-label="Reject">
          Reject
        </Button>
        <Button
          variant="primary"
          icon="check"
          onClick={onAccept}
          disabled={acceptDisabled}
          aria-label="Accept"
        >
          Accept
        </Button>
      </div>

      {/* Removed terms callout */}
      {removedTerms.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            padding: "8px 14px",
            borderBottom: "1px solid var(--rule)",
            background: "var(--paper-2)",
          }}
        >
          <span className="eyebrow" style={{ color: "var(--err)" }}>
            Removed protected terms
          </span>
          <Glyph name="warn" size={11} />
          {removedTerms.map((term) => (
            <ProtectedTermPill key={term} variant="removed">{term}</ProtectedTermPill>
          ))}
        </div>
      )}

      {/* Side-by-side diff */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "40px 1fr 40px 1fr",
          }}
        >
          {rows.map((row, i) => {
            const leftBg =
              row.type === "removed"
                ? "color-mix(in oklch, var(--err) 8%, transparent)"
                : "transparent";
            const rightBg =
              row.type === "added"
                ? "color-mix(in oklch, var(--ok) 8%, transparent)"
                : "transparent";
            const leftBorder =
              row.type === "removed" ? "2px solid var(--err)" : "2px solid transparent";
            const rightBorder =
              row.type === "added" ? "2px solid var(--ok)" : "2px solid transparent";
            return (
              <div key={i} style={{ display: "contents" }}>
                <div style={{ ...numStyle, background: leftBg, borderLeft: leftBorder }}>
                  {row.leftNo ?? ""}
                </div>
                <div style={{ ...cellBase, background: leftBg }}>
                  {row.type === "removed" && (
                    <span style={{ color: "var(--err)", userSelect: "none", marginRight: 4 }}>−</span>
                  )}
                  {row.left ?? ""}
                </div>
                <div style={{ ...numStyle, background: rightBg, borderLeft: rightBorder }}>
                  {row.rightNo ?? ""}
                </div>
                <div style={{ ...cellBase, background: rightBg }}>
                  {row.type === "added" && (
                    <span style={{ color: "var(--ok)", userSelect: "none", marginRight: 4 }}>+</span>
                  )}
                  {row.right ?? ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
