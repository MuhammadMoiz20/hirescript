import { Posting } from "../api";
import Button from "./ui/Button";

interface Props {
  posting: Posting;
  onClick: (id: number) => void;
  onPrepare: (id: number) => void;
  onSkip?: (id: number) => void;
  preparing?: boolean;
}

const TIER_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  dream: { bg: "color-mix(in oklch, var(--accent) 20%, var(--paper))", fg: "var(--ink)", label: "Dream" },
  targeted: { bg: "color-mix(in oklch, #2563eb 18%, var(--paper))", fg: "var(--ink)", label: "Targeted" },
  wide_net: { bg: "var(--paper-2)", fg: "var(--ink-2)", label: "Wide net" },
  skip: { bg: "var(--paper-2)", fg: "var(--ink-3)", label: "Skip" },
};

function fitScoreColor(score: number | null): string {
  if (score == null) return "var(--ink-3)";
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#2563eb";
  if (score >= 40) return "#92400e";
  return "var(--ink-3)";
}

function daysAgo(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function PostingCard({ posting, onClick, onPrepare, onSkip, preparing }: Props) {
  const tierMeta = posting.tier ? TIER_COLORS[posting.tier] : null;
  const score = posting.fit_score;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(posting.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(posting.id);
        }
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "auto auto 1fr auto auto",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid var(--rule)",
        background: "var(--paper)",
        cursor: "pointer",
        minHeight: 56,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--paper-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--paper)")}
    >
      {/* Tier badge */}
      <span
        aria-label={tierMeta ? `Tier: ${tierMeta.label}` : "No tier"}
        style={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          padding: "3px 7px",
          borderRadius: 3,
          fontWeight: 600,
          background: tierMeta ? tierMeta.bg : "var(--paper-2)",
          color: tierMeta ? tierMeta.fg : "var(--ink-3)",
          border: "1px solid var(--rule)",
          whiteSpace: "nowrap",
        }}
      >
        {tierMeta ? tierMeta.label : "—"}
      </span>

      {/* Fit score chip */}
      <span
        aria-label={score != null ? `Fit score ${score}` : "No fit score"}
        className="mono"
        style={{
          fontSize: 11,
          padding: "3px 6px",
          borderRadius: 3,
          border: "1px solid var(--rule)",
          color: fitScoreColor(score),
          minWidth: 32,
          textAlign: "center",
        }}
      >
        {score != null ? score : "—"}
      </span>

      {/* Company + title + meta */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {posting.company || "Unknown"}
          </span>
          <span style={{ color: "var(--ink-3)" }}>·</span>
          <span style={{ fontSize: 13, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {posting.title}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {posting.location && <span>{posting.location}</span>}
          <span className="mono" style={{ textTransform: "lowercase" }}>{posting.source}</span>
          <span
            aria-label="Apply mode B (read-only)"
            style={{
              fontSize: 10.5,
              padding: "1px 5px",
              borderRadius: 2,
              border: "1px solid var(--rule)",
              color: "var(--ink-3)",
            }}
          >
            B
          </span>
          <span>{daysAgo(posting.ingested_at)}</span>
          <span style={{ color: "var(--ink-3)" }}>· {posting.status}</span>
        </div>
      </div>

      {/* Actions */}
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6 }}>
        {onSkip && posting.status !== "skipped" && (
          <Button size="sm" variant="ghost" onClick={() => onSkip(posting.id)}>
            Skip
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={preparing || posting.status === "preparing" || posting.status === "prepared"}
          onClick={() => onPrepare(posting.id)}
        >
          {preparing ? "Preparing…" : "Prepare application"}
        </Button>
      </div>

      {/* Spacer overflow */}
      <span aria-hidden style={{ width: 4 }} />
    </div>
  );
}
