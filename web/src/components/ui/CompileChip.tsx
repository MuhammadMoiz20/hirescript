import Glyph from "./Glyph";
import ModelBadge, { ModelName } from "./ModelBadge";
import PageCountBadge, { PageCountState } from "./PageCountBadge";

interface Props {
  model?: ModelName;
  iterations?: number;
  tokensCached?: number;
  tokensFresh?: number;
  wallMs?: number;
  pageCount?: PageCountState | null;
  kind?: "done" | "compiling";
}

function Sep() {
  return <span style={{ color: "var(--rule-strong)" }}>·</span>;
}

const fmtNum = (n: number) => n.toLocaleString("en-US");

export default function CompileChip({
  model, iterations, tokensCached, tokensFresh, wallMs, pageCount, kind = "done",
}: Props) {
  return (
    <span className="mono" style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      padding: "3px 8px",
      border: "1px solid var(--rule)",
      background: "var(--paper-2)",
      color: "var(--ink-2)",
      fontSize: 11,
      borderRadius: 3,
      flexWrap: "wrap",
    }}>
      {kind === "compiling" ? (
        <span style={{ color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ animation: "blink 1.2s steps(1) infinite" }}><Glyph name="dots" size={11} stroke={2} /></span>
          compiling…
        </span>
      ) : (
        <>
          {model && <ModelBadge model={model} size="sm" />}
          {iterations != null && <><Sep /><span>iter {iterations}</span></>}
          {(tokensCached != null && tokensFresh != null) && (
            <><Sep /><span>{fmtNum(tokensCached)} cached · {fmtNum(tokensFresh)} fresh</span></>
          )}
          {wallMs != null && <><Sep /><span>{(wallMs / 1000).toFixed(1)}s</span></>}
          {pageCount != null && <><Sep /><PageCountBadge state={pageCount} size="sm" /></>}
        </>
      )}
    </span>
  );
}
