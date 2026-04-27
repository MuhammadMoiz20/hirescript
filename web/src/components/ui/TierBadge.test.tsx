import { render, screen } from "@testing-library/react";
import TierBadge, { Tier } from "./TierBadge";

const TIERS: Tier[] = ["dream", "targeted", "wide", "skip"];
const LABELS: Record<Tier, RegExp> = {
  dream: /dream/i,
  targeted: /targeted/i,
  wide: /wide net/i,
  skip: /skip/i,
};

test.each(TIERS)("renders %s tier with correct label and data-tier", (tier) => {
  const { container } = render(<TierBadge tier={tier} />);
  expect(screen.getByText(LABELS[tier])).toBeInTheDocument();
  const el = container.querySelector(`[data-tier="${tier}"]`);
  expect(el).not.toBeNull();
});

test.each(TIERS)("uses tier color token in style for %s", (tier) => {
  const { container } = render(<TierBadge tier={tier} />);
  const el = container.querySelector(`[data-tier="${tier}"]`) as HTMLElement;
  const tk = tier === "wide" ? "wide_net" : tier;
  expect(el.style.color).toContain(`var(--tier-${tk})`);
  expect(el.style.background).toContain(`var(--tier-${tk}-soft)`);
  expect(el.style.border).toContain(`var(--tier-${tk})`);
});

test("wide tier resolves to the wide_net CSS token (underscore preserved)", () => {
  const { container } = render(<TierBadge tier="wide" />);
  const el = container.querySelector(`[data-tier="wide"]`) as HTMLElement;
  expect(el.style.color).toContain("var(--tier-wide_net)");
});

test("supports compact and spacious sizes", () => {
  for (const size of ["sm", "lg"] as const) {
    const { container, unmount } = render(<TierBadge tier="dream" size={size} />);
    const el = container.querySelector(`[data-size="${size}"]`) as HTMLElement;
    expect(el).not.toBeNull();
    unmount();
  }
});

test("default size is compact (sm)", () => {
  const { container } = render(<TierBadge tier="dream" />);
  expect(container.querySelector(`[data-size="sm"]`)).not.toBeNull();
});
