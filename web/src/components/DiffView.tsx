import { useMemo } from "react";
import { diffLines } from "diff";
import Button from "./ui/Button";
import PageCountBadge from "./ui/PageCountBadge";
import ProtectedTermPill from "./ui/ProtectedTermPill";
import CompileChip from "./ui/CompileChip";
import { ModelName } from "./ui/ModelBadge";
import Glyph from "./ui/Glyph";

interface Props {
  currentLatex: string;
  proposedLatex: string;
  pageCount: number;
  enforced: boolean;
  removedTerms: string[];
  preservedTerms?: string[];
  onAccept: () => void;
  onReject: () => void;
  busy?: boolean;
  iterations?: number;
  /** Compile metadata for the header receipt. */
  model?: ModelName;
  tokensCached?: number;
  tokensFresh?: number;
  wallMs?: number;
  /** Fired when a numbered hotspot in the gutter is clicked. */
  onHotspotClick?: (id: number) => void;
}

type RowType = "context" | "added" | "removed";
interface Row {
  type: RowType;
  left: string | null;
  right: string | null;
  leftNo: number | null;
  rightNo: number | null;
  hotspot: number | null;
}

function buildRows(current: string, proposed: string): Row[] {
  const hunks = diffLines(current, proposed);
  const rows: Row[] = [];
  let leftNo = 1;
  let rightNo = 1;
  let hotspotId = 0;
  let inChange = false;
  let hotspotEmittedForRegion = false;
  for (const hunk of hunks) {
    const lines = hunk.value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const isChange = !!hunk.added || !!hunk.removed;
    if (isChange && !inChange) {
      hotspotId += 1;
      inChange = true;
      hotspotEmittedForRegion = false;
    } else if (!isChange) {
      inChange = false;
    }
    if (hunk.added) {
      lines.forEach((line, i) => {
        const emit = i === 0 && !hotspotEmittedForRegion;
        if (emit) hotspotEmittedForRegion = true;
        rows.push({
          type: "added",
          left: null,
          right: line,
          leftNo: null,
          rightNo: rightNo++,
          hotspot: emit ? hotspotId : null,
        });
      });
    } else if (hunk.removed) {
      lines.forEach((line, i) => {
        const emit = i === 0 && !hotspotEmittedForRegion;
        if (emit) hotspotEmittedForRegion = true;
        rows.push({
          type: "removed",
          left: line,
          right: null,
          leftNo: leftNo++,
          rightNo: null,
          hotspot: emit ? hotspotId : null,
        });
      });
    } else {
      for (const line of lines) {
        rows.push({
          type: "context",
          left: line,
          right: line,
          leftNo: leftNo++,
          rightNo: rightNo++,
          hotspot: null,
        });
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
  preservedTerms = [],
  onAccept,
  onReject,
  busy = false,
  iterations,
  model,
  tokensCached,
  tokensFresh,
  wallMs,
  onHotspotClick,
}: Props) {
  const rows = useMemo(() => buildRows(currentLatex, proposedLatex), [currentLatex, proposedLatex]);
  const acceptDisabled = !enforced || busy;
  const addedCount = rows.filter(r => r.type === "added").length;
  const removedCount = rows.filter(r => r.type === "removed").length;
  const diffSize = addedCount + removedCount;

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
  const hotspotCellStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1px 4px",
    minHeight: "1.6em",
    userSelect: "none",
  };

  return (
    <div
      data-testid="diff-view"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minWidth: 0,
        background: "var(--paper)",
      }}
    >
      {/* Compile metadata header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          borderBottom: "1px solid var(--rule)",
          background: "var(--paper)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="eyebrow">Review diff{model ? ` · ${model[0].toUpperCase()}${model.slice(1)}` : ""}</span>
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-3)" }}
            data-testid="diff-size"
          >
            {diffSize} line{diffSize === 1 ? "" : "s"} changed
          </span>
        </div>
        <span style={{ flex: 1 }} />
        <CompileChip
          kind="done"
          model={model}
          iterations={iterations}
          tokensCached={tokensCached}
          tokensFresh={tokensFresh}
          wallMs={wallMs}
          pageCount={enforced ? "ok" : (pageCount as number)}
        />
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--err)" }}
          aria-label={`${removedCount} lines removed`}
        >
          −{removedCount}
        </span>
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--ok)" }}
          aria-label={`${addedCount} lines added`}
        >
          +{addedCount}
        </span>
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

      {/* Protected-term strip (always visible — keeps the contract front-and-center) */}
      <div
        data-testid="protected-term-strip"
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
        <span className="eyebrow">Protected terms</span>
        {preservedTerms.length === 0 && removedTerms.length === 0 && (
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
            none pinned
          </span>
        )}
        {preservedTerms.map((term) => (
          <ProtectedTermPill key={`p-${term}`} variant="preserved">{term}</ProtectedTermPill>
        ))}
        {removedTerms.length > 0 && (
          <>
            <span style={{ color: "var(--rule-strong)" }}>·</span>
            <span className="eyebrow" style={{ color: "var(--err)" }}>
              <Glyph name="warn" size={11} /> Removed protected terms · blocking
            </span>
            {removedTerms.map((term) => (
              <ProtectedTermPill key={`r-${term}`} variant="removed">{term}</ProtectedTermPill>
            ))}
          </>
        )}
      </div>

      {/* Side-by-side diff with numbered hotspot gutter */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {diffSize === 0 && (
          <div
            data-testid="diff-empty"
            role="status"
            style={{
              padding: "32px 20px",
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <div className="mono" aria-hidden style={{ fontSize: 22, marginBottom: 8 }}>≡</div>
            <div className="serif" style={{ fontSize: 16, color: "var(--ink)", marginBottom: 4 }}>
              No changes to review
            </div>
            <div>The proposed LaTeX matches the current source line-for-line.</div>
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "40px 1fr 28px 40px 1fr",
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
            const hotspotBg =
              row.type === "removed"
                ? leftBg
                : row.type === "added"
                ? rightBg
                : "transparent";
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
                <div style={{ ...hotspotCellStyle, background: hotspotBg }}>
                  {row.hotspot != null && (
                    <button
                      type="button"
                      data-hotspot-id={row.hotspot}
                      aria-label={`Jump to PDF region ${row.hotspot}`}
                      onClick={() => onHotspotClick?.(row.hotspot!)}
                      className="mono"
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        border: "1px solid var(--rule-strong)",
                        background: "var(--paper)",
                        color: "var(--ink-2)",
                        fontSize: 10,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: onHotspotClick ? "pointer" : "default",
                        padding: 0,
                      }}
                    >
                      {row.hotspot}
                    </button>
                  )}
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
