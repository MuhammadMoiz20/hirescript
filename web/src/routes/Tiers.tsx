/**
 * Tiers — live editable policy surface (slice 3).
 *
 * Source: bundle `ma-screens-2.jsx::TiersPolicy`. The visual layout is
 * preserved from slice 2.5 (read-only stub); the data source and edit
 * affordances are new.
 *
 * Wiring:
 *   - GET /tiers on mount → render four cards.
 *   - PATCH /tiers/{slug} on edit:
 *       - daily_cap     : number input, PATCH on blur.
 *       - default_mode  : segmented A/B toggle, PATCH on click.
 *       - tailor_model  : <select>, PATCH on change.
 *       - enabled       : checkbox toggle, PATCH on click.
 *   - Optimistic local update; rollback + inline error on failure.
 *
 * `min_fit_score` is immutable in v1 (changing thresholds reshuffles
 * already-classified postings retroactively, which is out of scope).
 */
import { useEffect, useMemo, useState } from "react";
import {
  api,
  type TierPolicy,
  type TierUpdate,
} from "../api";
import TierBadge, { type Tier as TierBadgeKind } from "../components/ui/TierBadge";
import ModeToggle, { type Mode } from "../components/ui/ModeToggle";
import EmptyState from "../components/ui/EmptyState";

interface Props {
  onBack?: () => void;
}

/* Backend slug → frontend `TierBadge` kind. Bundle uses `wide` while the
 * backend uses `wide_net`; everything else maps 1:1. */
const SLUG_TO_BADGE: Record<string, TierBadgeKind> = {
  dream: "dream",
  targeted: "targeted",
  wide_net: "wide",
  skip: "skip",
};

const RIBBON_TOKEN: Record<TierBadgeKind, string> = {
  dream: "dream",
  targeted: "targeted",
  wide: "wide_net",
  skip: "skip",
};

const TAILOR_MODEL_CHOICES: TierPolicy["tailor_model"][] = [
  "haiku-4.5",
  "sonnet-4.6",
  "opus-4.7",
];

export default function Tiers(_props: Props = {}) {
  const [tiers, setTiers] = useState<TierPolicy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listTiers()
      .then((rows) => {
        if (cancelled) return;
        // Order by min_fit_score desc to mirror the backend ordering.
        setTiers([...rows].sort((a, b) => b.min_fit_score - a.min_fit_score));
      })
      .catch((e: any) => {
        if (cancelled) return;
        setLoadError(
          e?.detail ? String(e.detail) : e?.message || "Failed to load tiers",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePatched = (next: TierPolicy) =>
    setTiers((prev) =>
      (prev || []).map((t) => (t.slug === next.slug ? next : t)),
    );

  const orderedForRibbon = useMemo(
    () =>
      (tiers || []).slice().sort((a, b) => a.min_fit_score - b.min_fit_score),
    [tiers],
  );

  return (
    <div
      data-testid="tiers-route"
      style={{
        height: "100%",
        overflowY: "auto",
        background: "var(--paper)",
        padding: "20px 24px 32px",
      }}
    >
      <header style={{ marginBottom: 18 }}>
        <div
          className="eyebrow"
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          Tiers
        </div>
        <h1
          style={{
            fontFamily: "var(--f-serif)",
            fontSize: 26,
            letterSpacing: "-0.01em",
            margin: "2px 0 4px",
            color: "var(--ink)",
          }}
        >
          The classifier's verdict, in policy form
        </h1>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
          Each posting lands in one of four buckets. Each bucket sets its own
          model, mode, cap, and verifier strictness.
        </div>
      </header>

      {loadError && (
        <div
          role="alert"
          data-testid="tiers-load-error"
          style={{
            border: "1px solid var(--err)",
            background: "color-mix(in oklch, var(--err) 10%, var(--paper))",
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--ink)",
            marginBottom: 18,
            borderRadius: 3,
          }}
        >
          {loadError}
        </div>
      )}

      <Section
        title="Fit score thresholds"
        sub="The classifier returns a 0–100 score. Boundaries are set by `min_fit_score` per tier and immutable in v1."
      >
        <ThresholdRibbon tiers={orderedForRibbon} />
      </Section>

      <Section
        title="Per-tier policy"
        sub="Daily cap, default mode, tailor model, and enabled state are editable. PATCH fires on blur or change."
      >
        {tiers === null ? (
          <div
            data-testid="tiers-loading"
            style={{
              padding: 24,
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            loading…
          </div>
        ) : tiers.length === 0 ? (
          <EmptyState
            testid="tiers-empty"
            title="No tier policy rows"
            body="The tiers table is empty. Re-run the slice-3 migration to seed the four default rows."
          />
        ) : (
          <div
            data-testid="tiers-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              gap: 16,
            }}
          >
            {tiers.map((t) => (
              <TierCard key={t.slug} tier={t} onPatched={handlePatched} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ─── Section helper ───────────────────────────────────────────────────── */

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      <header style={{ marginBottom: 10 }}>
        <div
          style={{
            fontFamily: "var(--f-serif)",
            fontSize: 16,
            color: "var(--ink)",
          }}
        >
          {title}
        </div>
        {sub && (
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
            {sub}
          </div>
        )}
      </header>
      {children}
    </section>
  );
}

/* ─── Threshold ribbon ─────────────────────────────────────────────────── */

function ThresholdRibbon({ tiers }: { tiers: TierPolicy[] }) {
  // Compute segment widths from min_fit_score: each tier owns the band from
  // its min up to the next tier's min (or 100 for the top tier).
  const segments = useMemo(() => {
    if (tiers.length === 0) return [];
    return tiers.map((t, i) => {
      const start = t.min_fit_score;
      const end = i + 1 < tiers.length ? tiers[i + 1].min_fit_score : 100;
      return {
        slug: t.slug,
        badgeKind: SLUG_TO_BADGE[t.slug] || "skip",
        label: t.display_name,
        fitMin: start,
        fitMax: Math.max(start, end - (i + 1 < tiers.length ? 1 : 0)),
        startPct: start,
        widthPct: Math.max(0, end - start),
      };
    });
  }, [tiers]);

  const boundaries = useMemo(
    () => tiers.map((t) => t.min_fit_score).filter((v) => v > 0),
    [tiers],
  );

  return (
    <div
      data-testid="tiers-ribbon"
      style={{
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        padding: 24,
        borderRadius: 3,
      }}
    >
      <div style={{ position: "relative", height: 64 }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 28,
            left: 0,
            right: 0,
            height: 8,
            background: "var(--paper-3)",
          }}
        />
        {segments.map((s) => (
          <div
            key={`seg-${s.slug}`}
            data-testid={`ribbon-seg-${s.badgeKind}`}
            aria-hidden
            style={{
              position: "absolute",
              top: 28,
              height: 8,
              left: `${s.startPct}%`,
              width: `${s.widthPct}%`,
              background: `var(--tier-${RIBBON_TOKEN[s.badgeKind]})`,
              opacity: s.slug === "skip" ? 0.6 : 1,
            }}
          />
        ))}
        {segments.map((s) => {
          const cx = s.startPct + s.widthPct / 2;
          return (
            <div
              key={`lbl-${s.slug}`}
              style={{
                position: "absolute",
                left: `${cx}%`,
                top: 0,
                transform: "translateX(-50%)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 10,
                  color: `var(--tier-${RIBBON_TOKEN[s.badgeKind]})`,
                  fontWeight: 600,
                }}
              >
                {s.fitMin}–{s.fitMax}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink)", marginTop: 2 }}>
                {s.label}
              </div>
            </div>
          );
        })}
        {boundaries.map((v) => (
          <div
            key={`mark-${v}`}
            data-testid={`ribbon-mark-${v}`}
            aria-hidden
            style={{
              position: "absolute",
              left: `${v}%`,
              top: 24,
              transform: "translateX(-50%)",
              width: 2,
              height: 16,
              background: "var(--ink)",
            }}
          />
        ))}
        <div
          aria-hidden
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          {[0, 25, 50, 75, 100].map((v) => (
            <span
              key={v}
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10,
                color: "var(--ink-4)",
              }}
            >
              {v}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Tier card ────────────────────────────────────────────────────────── */

function TierCard({
  tier,
  onPatched,
}: {
  tier: TierPolicy;
  onPatched: (next: TierPolicy) => void;
}) {
  const badgeKind = SLUG_TO_BADGE[tier.slug] || "skip";
  const [capDraft, setCapDraft] = useState<string>(String(tier.daily_cap));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-sync the local draft when the upstream tier changes (e.g. after PATCH).
  useEffect(() => {
    setCapDraft(String(tier.daily_cap));
  }, [tier.daily_cap]);

  async function patch(body: TierUpdate, optimistic: TierPolicy) {
    setError(null);
    const previous = tier;
    onPatched(optimistic);
    setBusy(true);
    try {
      const updated = await api.updateTier(tier.slug, body);
      onPatched(updated);
    } catch (e: any) {
      onPatched(previous);
      const detail = e?.detail
        ? typeof e.detail === "string"
          ? e.detail
          : JSON.stringify(e.detail)
        : e?.message || "Update failed";
      setError(detail);
    } finally {
      setBusy(false);
    }
  }

  function commitCap() {
    const parsed = Number(capDraft);
    if (!Number.isFinite(parsed) || Math.floor(parsed) !== parsed || parsed < 0) {
      setError("daily_cap must be a non-negative integer");
      setCapDraft(String(tier.daily_cap));
      return;
    }
    if (parsed === tier.daily_cap) return;
    void patch({ daily_cap: parsed }, { ...tier, daily_cap: parsed });
  }

  function flipMode(next: Mode) {
    if (next === tier.default_mode) return;
    void patch({ default_mode: next }, { ...tier, default_mode: next });
  }

  function flipEnabled() {
    void patch({ enabled: !tier.enabled }, { ...tier, enabled: !tier.enabled });
  }

  function changeModel(model: TierPolicy["tailor_model"]) {
    if (model === tier.tailor_model) return;
    void patch({ tailor_model: model }, { ...tier, tailor_model: model });
  }

  const aModeDisabled = tier.daily_cap === 0;

  return (
    <article
      data-testid={`tier-card-${tier.slug}`}
      style={{
        border: "1px solid var(--rule)",
        background: "var(--paper)",
        padding: 16,
        borderRadius: 3,
        opacity: tier.enabled ? 1 : 0.65,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TierBadge tier={badgeKind} size="lg" />
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-3)" }}
          >
            min fit score: {tier.min_fit_score}
          </span>
        </div>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            aria-label="Enabled"
            checked={tier.enabled}
            onChange={flipEnabled}
            disabled={busy}
          />
          Enabled
        </label>
      </header>

      {error && (
        <div
          role="alert"
          data-testid={`tier-card-${tier.slug}-error`}
          style={{
            fontSize: 12,
            color: "var(--err)",
            background: "color-mix(in oklch, var(--err) 8%, var(--paper))",
            border: "1px solid var(--err)",
            padding: "6px 10px",
            borderRadius: 3,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      {/* Editable controls. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr",
          rowGap: 10,
          columnGap: 12,
          fontSize: 12,
          alignItems: "center",
        }}
      >
        <label
          htmlFor={`tier-${tier.slug}-cap`}
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 10,
            color: "var(--ink-4)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Daily cap
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            id={`tier-${tier.slug}-cap`}
            aria-label="Daily cap"
            type="number"
            min={0}
            value={capDraft}
            disabled={busy || !tier.enabled}
            onChange={(e) => setCapDraft(e.target.value)}
            onBlur={commitCap}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            style={{
              width: 90,
              fontFamily: "var(--f-mono)",
              fontSize: 12,
              padding: "4px 8px",
              border: "1px solid var(--rule-strong)",
              borderRadius: 3,
              background: "var(--paper)",
              color: "var(--ink)",
            }}
          />
          {aModeDisabled && (
            <span
              data-testid={`tier-card-${tier.slug}-amode-disabled`}
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10,
                color: "var(--ink-3)",
              }}
            >
              A-mode disabled
            </span>
          )}
        </div>

        <span
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 10,
            color: "var(--ink-4)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Default mode
        </span>
        <ModeToggle
          mode={tier.default_mode}
          onChange={flipMode}
          disabled={busy || !tier.enabled}
        />

        <label
          htmlFor={`tier-${tier.slug}-model`}
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 10,
            color: "var(--ink-4)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Tailor model
        </label>
        <select
          id={`tier-${tier.slug}-model`}
          aria-label="Tailor model"
          value={tier.tailor_model}
          disabled={busy || !tier.enabled}
          onChange={(e) =>
            changeModel(e.target.value as TierPolicy["tailor_model"])
          }
          style={{
            width: 160,
            fontFamily: "var(--f-mono)",
            fontSize: 12,
            padding: "4px 8px",
            border: "1px solid var(--rule-strong)",
            borderRadius: 3,
            background: "var(--paper)",
            color: "var(--ink)",
          }}
        >
          {TAILOR_MODEL_CHOICES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <span
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 10,
            color: "var(--ink-4)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Classify
        </span>
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-3)" }}
          title="Classify model is fixed in v1."
        >
          {tier.classify_model}
        </span>
      </div>

      <footer
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: "1px solid var(--rule)",
          fontFamily: "var(--f-mono)",
          fontSize: 10,
          color: "var(--ink-4)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{tier.display_name}</span>
        {tier.updated_at && (
          <span data-testid={`tier-card-${tier.slug}-updated`}>
            updated {new Date(tier.updated_at).toLocaleString()}
          </span>
        )}
      </footer>
    </article>
  );
}
