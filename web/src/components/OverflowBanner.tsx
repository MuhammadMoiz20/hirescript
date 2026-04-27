import Button from "./ui/Button";
import Glyph from "./ui/Glyph";
import PageCountBadge from "./ui/PageCountBadge";

interface Props {
  pageCount: number;
  overflowCount?: number;
  onTighten: () => void;
  busy?: boolean;
}

/**
 * Overflow banner — bundle's `screens-a.jsx::EditorScreen` red-ink chrome.
 *
 * Visible whenever the resume renders to anything other than 1 page (the
 * one-page invariant), or when individual lines bleed past the right margin.
 * Save-as-final / publish flows must remain blocked while this banner is up;
 * the banner does not hide content, it surfaces the overflow and offers a
 * "tighten without losing protected terms" CTA.
 *
 * Pairs with `body[data-overflow="true"]`, which the Editor route sets to
 * paint the top chrome's bottom border in `--err`.
 */
export default function OverflowBanner({
  pageCount, overflowCount = 0, onTighten, busy = false,
}: Props) {
  const pageOverflow = pageCount > 1;
  const lineOverflow = overflowCount > 0;
  if (!pageOverflow && !lineOverflow) return null;

  const headline = pageOverflow
    ? `Resume is ${pageCount} pages.`
    : `${overflowCount} line${overflowCount === 1 ? "" : "s"} overflow the right margin.`;
  const advisory = pageOverflow
    ? "Save as final is disabled until it's back to one page."
    : "Bullets wrap with one or two orphan words — looks unprofessional and wastes vertical space.";
  const buttonLabel = busy
    ? "Tightening…"
    : pageOverflow ? "Ask Claude to tighten" : "Fix line overflows";

  return (
    <div
      role="alert"
      data-testid="overflow-banner"
      style={{
        background: "var(--err-soft)",
        borderBottom: "1px solid color-mix(in oklch, var(--err) 30%, transparent)",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
        color: "var(--err)",
        flexShrink: 0,
      }}
    >
      <Glyph name="warn" size={14} />
      <span style={{ fontWeight: 600 }}>{headline}</span>
      <span style={{ color: "var(--ink-2)" }}>{advisory}</span>
      {pageOverflow && (
        <span style={{ marginLeft: 4 }}>
          <PageCountBadge state="over" size="sm" />
        </span>
      )}
      <span style={{ flex: 1 }} />
      <Button
        onClick={onTighten}
        disabled={busy}
        variant="primary"
        size="sm"
        icon="sparkle"
      >
        {buttonLabel}
      </Button>
    </div>
  );
}
