/**
 * TierBadge — mass-apply primitive.
 *
 * Indicates which targeting tier a posting/application belongs to.
 * Hue mapping per design bundle:
 *   - dream    → violet  (var(--tier-dream))
 *   - targeted → blue    (var(--tier-targeted))
 *   - wide     → green   (var(--tier-wide_net))   *bundle uses wide_net token name*
 *   - skip     → neutral (var(--tier-skip))
 *
 * Sizes: "sm" (compact, default) and "lg" (spacious).
 */

export type Tier = "dream" | "targeted" | "wide" | "skip";

interface Props {
  tier: Tier;
  size?: "sm" | "lg";
}

const LABELS: Record<Tier, string> = {
  dream: "Dream",
  targeted: "Targeted",
  wide: "Wide net",
  skip: "Skip",
};

// The CSS token uses `wide_net` (with underscore) per bundle. Map prop → token.
const TOKEN_KEY: Record<Tier, string> = {
  dream: "dream",
  targeted: "targeted",
  wide: "wide_net",
  skip: "skip",
};

export default function TierBadge({ tier, size = "sm" }: Props) {
  const fontSize = size === "lg" ? 12 : 10;
  const padY = size === "lg" ? 3 : 2;
  const padX = size === "lg" ? 9 : 7;
  const tk = TOKEN_KEY[tier];

  return (
    <span
      data-tier={tier}
      data-size={size}
      title={LABELS[tier]}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: `${padY}px ${padX}px`,
        fontFamily: "var(--f-mono)",
        fontSize,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: `var(--tier-${tk})`,
        background: `var(--tier-${tk}-soft)`,
        border: `1px solid var(--tier-${tk})`,
        borderRadius: 2,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: 5,
          background: `var(--tier-${tk})`,
          display: "inline-block",
        }}
      />
      {LABELS[tier]}
    </span>
  );
}
