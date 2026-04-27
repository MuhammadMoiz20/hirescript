/**
 * Tiers — read-only display of the classifier's tier policy.
 *
 * Source: bundle `ma-screens-2.jsx::TiersPolicy`.
 *
 * SLICE 2.5 SCOPE
 * ───────────────
 * The backend has no `tiers` table yet — fit-score thresholds and per-stage
 * model assignments are hardcoded. This view renders those canonical values
 * read-only and surfaces a banner explaining that editability ships in
 * Slice 3 with the backend table + endpoints.
 *
 * Threshold values mirror `api/app/services/classify.py` (system prompt
 * "Tier rules"):
 *   - skip       : fit_score < 40
 *   - wide_net   : fit_score 40–59
 *   - targeted   : fit_score 60–84
 *   - dream      : fit_score >= 85
 *
 * Per-stage models reflect what the actual services use today:
 *   - classify   → haiku  (api/app/services/classify.py)
 *   - jd parser  → haiku  (api/app/services/jd_parser.py)
 *   - tailor     → sonnet (api/app/services/tailor.py — opus only when deep_tailor)
 *   - cover      → sonnet (api/app/services/cover_letter.py)
 *   - enforcer   → haiku iter 1-2, sonnet iter 3+ (api/app/services/enforcer.py)
 *
 * The "research" stage is bundle-only — no backend implementation yet — so
 * it is shown as `— off` in every row to avoid pretending it exists.
 *
 * UI is intentionally inert:
 *   - No drag handles on the threshold ribbon (markers only).
 *   - <ModeToggle disabled />.
 *   - Daily caps and verifier strictness are placeholder labels with a TODO.
 */
import TierBadge, { type Tier as TierBadgeKind } from "../components/ui/TierBadge";
import ModeToggle, { type Mode } from "../components/ui/ModeToggle";
import ModelBadge, { type ModelName } from "../components/ui/ModelBadge";

interface Props {
  onBack?: () => void;
}

type StageModel = ModelName | "off";

interface TierConfig {
  /** Frontend tier key — matches `TierBadge`'s union (`wide_net` → `wide`). */
  id: TierBadgeKind;
  /** Backend tier slug, exactly as classify.py emits it. */
  backendKey: "dream" | "targeted" | "wide_net" | "skip";
  label: string;
  fitMin: number;
  fitMax: number;
  /** % of the 0–100 ribbon this tier occupies. */
  ribbonStartPct: number;
  ribbonWidthPct: number;
  models: {
    classify: StageModel;
    research: StageModel;
    tailor: StageModel;
    cover: StageModel;
  };
  defaultMode: Mode;
  verifier: "strict" | "lenient" | "n/a";
  /** Visual cap placeholder; backend doesn't enforce per-tier caps yet. */
  dailyCap: number | null;
  examples: string[];
}

// Canonical config — values must match the backend (see classify.py docstring).
// When Slice 3 adds the `tiers` table this constant should be replaced by a
// fetch; until then it is the single source of UI truth.
const TIERS: TierConfig[] = [
  {
    id: "dream",
    backendKey: "dream",
    label: "Dream",
    fitMin: 85,
    fitMax: 100,
    ribbonStartPct: 85,
    ribbonWidthPct: 15,
    models: { classify: "haiku", research: "off", tailor: "sonnet", cover: "sonnet" },
    defaultMode: "B",
    verifier: "strict",
    dailyCap: null,
    examples: ["Anthropic — Inference", "Stripe — Staff MM"],
  },
  {
    id: "targeted",
    backendKey: "targeted",
    label: "Targeted",
    fitMin: 60,
    fitMax: 84,
    ribbonStartPct: 60,
    ribbonWidthPct: 25,
    models: { classify: "haiku", research: "off", tailor: "sonnet", cover: "sonnet" },
    defaultMode: "B",
    verifier: "strict",
    dailyCap: null,
    examples: ["Linear — Staff Product Eng", "Vercel — Edge"],
  },
  {
    id: "wide",
    backendKey: "wide_net",
    label: "Wide net",
    fitMin: 40,
    fitMax: 59,
    ribbonStartPct: 40,
    ribbonWidthPct: 20,
    models: { classify: "haiku", research: "off", tailor: "sonnet", cover: "sonnet" },
    defaultMode: "B",
    verifier: "lenient",
    dailyCap: null,
    examples: ["Brex — SE III", "Retool — Backend"],
  },
  {
    id: "skip",
    backendKey: "skip",
    label: "Skip",
    fitMin: 0,
    fitMax: 39,
    ribbonStartPct: 0,
    ribbonWidthPct: 40,
    models: { classify: "haiku", research: "off", tailor: "off", cover: "off" },
    defaultMode: "B",
    verifier: "n/a",
    dailyCap: 0,
    examples: ["Zapier — Generalist", "Intercom — Junior FE"],
  },
];

// Bundle uses `wide_net` as the CSS token (with underscore). Map our id → token.
const RIBBON_TOKEN: Record<TierBadgeKind, string> = {
  dream: "dream",
  targeted: "targeted",
  wide: "wide_net",
  skip: "skip",
};

export default function Tiers(_props: Props = {}) {
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

      {/* Read-only banner. */}
      <div
        role="status"
        data-testid="tiers-readonly-banner"
        style={{
          border: "1px solid var(--rule)",
          background: "var(--paper-2)",
          padding: "10px 14px",
          fontSize: 12.5,
          color: "var(--ink-2)",
          marginBottom: 18,
          borderRadius: 3,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 6,
            background: "var(--ink-3)",
          }}
        />
        <span>
          <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
            Tier configuration is coming in Slice 3.
          </strong>{" "}
          The values below mirror the hardcoded thresholds in{" "}
          <code className="mono" style={{ fontSize: 11.5 }}>
            api/app/services/classify.py
          </code>
          . Edit + persist will land with the <code className="mono" style={{ fontSize: 11.5 }}>tiers</code> table.
        </span>
      </div>

      {/* Threshold ribbon — non-interactive markers, no drag handles. */}
      <Section
        title="Fit score thresholds"
        sub="The classifier returns a 0–100 score. Boundaries are fixed in this slice."
      >
        <ThresholdRibbon />
      </Section>

      {/* Per-tier cards. */}
      <Section
        title="Per-tier policy"
        sub="Models per stage, default mode, daily cap (placeholder), verifier strictness."
      >
        <div
          data-testid="tiers-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 16,
          }}
        >
          {TIERS.map((t) => (
            <TierCard key={t.id} tier={t} />
          ))}
        </div>
      </Section>

      {/* Global override knobs — placeholders. */}
      <Section
        title="Global override knobs"
        sub="Apply on top of tier defaults. Slice 3 will add edit + persist."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          <PlaceholderCard
            eyebrow="Mode floor"
            value="Tier defaults"
            note="Slice 3 will add A/B mode floor toggle."
          />
          <PlaceholderCard
            eyebrow="Daily mass cap"
            value="—"
            note="No global cap enforced. Slice 3 backend gap."
          />
          <PlaceholderCard
            eyebrow="Spending kill-switch"
            value="—"
            note="No spend tracking in Slice 2 backend."
          />
        </div>
      </Section>

      <div
        style={{
          marginTop: 20,
          fontSize: 11.5,
          color: "var(--ink-3)",
          fontFamily: "var(--f-mono)",
        }}
      >
        ↳ Slice 3 will introduce a <code>tiers</code> table + CRUD endpoints
        and make this surface fully editable.
      </div>
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

function ThresholdRibbon() {
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
        {/* Track */}
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
        {/* Tier segments */}
        {TIERS.map((t) => (
          <div
            key={`seg-${t.id}`}
            data-testid={`ribbon-seg-${t.id}`}
            aria-hidden
            style={{
              position: "absolute",
              top: 28,
              height: 8,
              left: `${t.ribbonStartPct}%`,
              width: `${t.ribbonWidthPct}%`,
              background: `var(--tier-${RIBBON_TOKEN[t.id]})`,
              opacity: t.id === "skip" ? 0.6 : 1,
            }}
          />
        ))}
        {/* Labels above segments */}
        {TIERS.map((t) => {
          const cx = t.ribbonStartPct + t.ribbonWidthPct / 2;
          return (
            <div
              key={`lbl-${t.id}`}
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
                  color: `var(--tier-${RIBBON_TOKEN[t.id]})`,
                  fontWeight: 600,
                }}
              >
                {t.fitMin}–{t.fitMax}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink)", marginTop: 2 }}>
                {t.label}
              </div>
            </div>
          );
        })}
        {/* Boundary markers — non-interactive (no drag), just thin ticks. */}
        {[40, 60, 85].map((v) => (
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
        {/* Scale ticks */}
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
      <div
        style={{
          marginTop: 16,
          fontSize: 12,
          color: "var(--ink-3)",
          lineHeight: 1.6,
        }}
      >
        Read-only:{" "}
        <span className="mono">
          skip ≤ 39 · wide 40–59 · targeted 60–84 · dream ≥ 85
        </span>
      </div>
    </div>
  );
}

/* ─── Tier card ────────────────────────────────────────────────────────── */

function TierCard({ tier }: { tier: TierConfig }) {
  return (
    <article
      data-testid={`tier-card-${tier.id}`}
      style={{
        border: "1px solid var(--rule)",
        background: "var(--paper)",
        padding: 16,
        borderRadius: 3,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TierBadge tier={tier.id} size="lg" />
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-3)" }}
          >
            fit {tier.fitMin}–{tier.fitMax}
          </span>
        </div>
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-3)" }}
          title="Per-tier daily caps not enforced in Slice 2"
        >
          {tier.dailyCap === null
            ? "— / — today"
            : `0 / ${tier.dailyCap} today`}
        </span>
      </header>

      {/* Per-stage model breakdown. */}
      <div
        data-testid={`tier-card-${tier.id}-models`}
        style={{
          display: "grid",
          gridTemplateColumns: "84px 1fr",
          rowGap: 8,
          columnGap: 12,
          fontSize: 12,
        }}
      >
        <StageRow label="Classify" model={tier.models.classify} offNote="off" />
        <StageRow label="Research" model={tier.models.research} offNote="off" />
        <StageRow
          label="Tailor"
          model={tier.models.tailor}
          offNote={tier.id === "skip" ? "off (skip)" : "off"}
        />
        <StageRow label="Cover" model={tier.models.cover} offNote="none" />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--rule)",
          flexWrap: "wrap",
        }}
      >
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
        <ModeToggle mode={tier.defaultMode} disabled />
        <span
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 10,
            color: "var(--ink-4)",
            marginLeft: "auto",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Verifier
        </span>
        <span
          data-testid={`tier-card-${tier.id}-verifier`}
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            color:
              tier.verifier === "strict"
                ? "var(--ink)"
                : tier.verifier === "lenient"
                  ? "var(--ink-3)"
                  : "var(--ink-4)",
          }}
        >
          {tier.verifier}
        </span>
      </div>

      <div
        style={{
          marginTop: 12,
          fontSize: 11,
          color: "var(--ink-3)",
          lineHeight: 1.6,
        }}
      >
        Examples: {tier.examples.join(" · ")}
      </div>
    </article>
  );
}

function StageRow({
  label,
  model,
  offNote,
}: {
  label: string;
  model: StageModel;
  offNote: string;
}) {
  return (
    <>
      <div
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 10,
          color: "var(--ink-4)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          alignSelf: "center",
        }}
      >
        {label}
      </div>
      <div>
        {model === "off" ? (
          <span
            style={{
              color: "var(--ink-4)",
              fontFamily: "var(--f-mono)",
              fontSize: 11,
            }}
          >
            — {offNote}
          </span>
        ) : (
          <ModelBadge model={model} size="sm" />
        )}
      </div>
    </>
  );
}

/* ─── Placeholder card (global overrides) ──────────────────────────────── */

function PlaceholderCard({
  eyebrow,
  value,
  note,
}: {
  eyebrow: string;
  value: string;
  note: string;
}) {
  return (
    <div
      data-testid={`tiers-placeholder-${eyebrow.toLowerCase().replace(/\s+/g, "-")}`}
      style={{
        border: "1px solid var(--rule)",
        background: "var(--paper)",
        padding: 16,
        borderRadius: 3,
      }}
    >
      <div
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: "var(--f-mono)",
          fontSize: 24,
          color: "var(--ink-2)",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
        {note}
      </div>
    </div>
  );
}
