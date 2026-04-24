import { diffLines } from "diff";

interface Props {
  currentLatex: string;
  proposedLatex: string;
  pageCount: number;
  enforced: boolean;
  removedTerms: string[];
  onAccept: () => void;
  onReject: () => void;
  busy?: boolean;
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
}: Props) {
  const hunks = diffLines(currentLatex, proposedLatex);

  const isOnePage = pageCount === 1;
  const badgeLabel = isOnePage
    ? "\u2713 1 page"
    : `\u2717 ${pageCount} page${pageCount === 1 ? "" : "s"}`;
  const badgeStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    background: isOnePage ? "#d4f5dd" : "#fadbd8",
    color: isOnePage ? "#1b5e20" : "#8b1a1a",
  };

  const acceptDisabled = !enforced || busy;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 8,
          borderBottom: "1px solid #ddd",
        }}
      >
        <span style={badgeStyle} aria-label="page count">
          {badgeLabel}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onAccept}
          disabled={acceptDisabled}
          aria-label="Accept"
        >
          Accept
        </button>
        <button onClick={onReject} disabled={busy} aria-label="Reject">
          Reject
        </button>
      </div>

      {removedTerms.length > 0 && (
        <div
          style={{
            background: "#fadbd8",
            color: "#8b1a1a",
            padding: 8,
            borderBottom: "1px solid #f5b7b1",
            fontSize: 13,
          }}
        >
          <div style={{ marginBottom: 4, fontWeight: 600 }}>
            Removed protected terms:
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {removedTerms.map((term) => (
              <span
                key={term}
                style={{
                  background: "#fff",
                  border: "1px solid #f5b7b1",
                  borderRadius: 10,
                  padding: "2px 8px",
                  fontSize: 12,
                }}
              >
                {term}
              </span>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflow: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          padding: 8,
          whiteSpace: "pre-wrap",
        }}
      >
        {hunks.map((hunk, idx) => {
          const lines = hunk.value.split("\n");
          // Drop trailing empty element from a terminal newline
          if (lines.length > 0 && lines[lines.length - 1] === "") {
            lines.pop();
          }
          const marker = hunk.added ? "+" : hunk.removed ? "-" : " ";
          const bg = hunk.added
            ? "#e6ffed"
            : hunk.removed
            ? "#ffeef0"
            : "transparent";
          const color = hunk.added ? "#22863a" : hunk.removed ? "#b31d28" : "#24292e";
          return (
            <div key={idx}>
              {lines.map((line, li) => (
                <div
                  key={li}
                  style={{ background: bg, color, padding: "0 4px" }}
                >
                  <span style={{ userSelect: "none", opacity: 0.7 }}>{marker} </span>
                  {line}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
