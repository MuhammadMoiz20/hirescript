import Glyph from "./Glyph";
import ModelBadge, { ModelName } from "./ModelBadge";
import PageCountBadge, { PageCountState } from "./PageCountBadge";

/**
 * CompileChip — compile-state pill.
 *
 * Two render modes:
 *   1. Status modes (`queued` | `compiling` | `failed`): a compact mono pill
 *      showing only the current compile state. Use these in lists and headers
 *      where the rich receipt isn't yet available.
 *   2. Receipt mode (`done` / `ok`): renders the AI compile receipt
 *      `model · iter · cached/fresh tokens · wall-ms · pageCount`, matching
 *      the suite design bundle's CompileChip.
 */
export type CompileChipKind = "done" | "ok" | "compiling" | "queued" | "failed";

interface Props {
  model?: ModelName;
  iterations?: number;
  tokensCached?: number;
  tokensFresh?: number;
  wallMs?: number;
  pageCount?: PageCountState | null;
  kind?: CompileChipKind;
}

function Sep() {
  return <span style={{ color: "var(--rule-strong)" }}>·</span>;
}

const fmtNum = (n: number) => n.toLocaleString("en-US");

const STATUS_TONES: Record<"queued" | "compiling" | "failed", { fg: string; bd: string; bg: string }> = {
  queued:    { fg: "var(--ink-3)", bd: "var(--rule)",  bg: "var(--paper-2)" },
  compiling: { fg: "var(--ink-3)", bd: "var(--rule)",  bg: "var(--paper-2)" },
  failed:    { fg: "var(--err)",   bd: "color-mix(in oklch, var(--err) 30%, transparent)", bg: "var(--err-soft)" },
};

export default function CompileChip({
  model, iterations, tokensCached, tokensFresh, wallMs, pageCount, kind = "done",
}: Props) {
  const isStatus = kind === "queued" || kind === "compiling" || kind === "failed";
  const tones = isStatus ? STATUS_TONES[kind] : undefined;

  return (
    <span
      className="mono"
      data-kind={kind}
      role="status"
      style={{
        display: "inline-flex", alignItems: "center", gap: 10,
        padding: "3px 8px",
        border: `1px solid ${tones?.bd ?? "var(--rule)"}`,
        background: tones?.bg ?? "var(--paper-2)",
        color: tones?.fg ?? "var(--ink-2)",
        fontSize: 11,
        borderRadius: 3,
        flexWrap: "wrap",
      }}
    >
      {kind === "compiling" && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ animation: "blink 1.2s steps(1) infinite" }}><Glyph name="dots" size={11} stroke={2} /></span>
          compiling…
        </span>
      )}
      {kind === "queued" && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Glyph name="dash" size={11} stroke={2} />
          queued
        </span>
      )}
      {kind === "failed" && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Glyph name="warn" size={11} stroke={2} />
          failed
        </span>
      )}
      {(kind === "done" || kind === "ok") && (
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
