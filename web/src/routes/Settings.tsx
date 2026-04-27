/**
 * Settings — workspace, API key, model defaults, exports, danger zone.
 *
 * Source: bundle `ma-screens-2.jsx::Settings`.
 *
 * SLICE 2.5 SCOPE
 * ───────────────
 * Settings is *display + client-side persistence only* in this slice.
 * No new backend endpoints — every section either:
 *   - Renders read-only system info (Workspace timezone/locale).
 *   - Persists to `localStorage` only (Anthropic API key — kept on client).
 *   - Mirrors hardcoded backend defaults (Model defaults — see Tiers.tsx).
 *   - Calls an existing API (Exports → `api.getProfile` → JSON download).
 *   - Disabled with TODO when the backend gap is real (bulk KB delete,
 *     Max subscription connect).
 *
 * The danger zone uses a typed-confirm pattern: the destructive button only
 * enables when the user types the literal resource name into the input. We
 * never wire fake destructive endpoints — actions that would require a
 * server-side mutation we don't own are disabled with a "Coming in Slice 3"
 * note.
 *
 * Design treatment matches the rest of slice 2.5 (Tiers, Dashboard, etc.):
 * eyebrow + serif title page header, paper card surfaces, monospaced labels
 * for system metadata.
 */
import { useMemo, useState } from "react";
import ModelBadge, { type ModelName } from "../components/ui/ModelBadge";
import { api } from "../api";

interface Props {
  onBack?: () => void;
}

/** localStorage key for the user-supplied Anthropic API key. */
const API_KEY_STORAGE = "hs-anthropic-api-key";

/** localStorage keys this app owns — wiped by "Wipe browser artifacts". */
const APP_LOCALSTORAGE_KEYS = ["hs-theme", API_KEY_STORAGE];

/**
 * Per-stage model defaults — mirror the hardcoded values in
 * `api/app/services/*` (see Tiers.tsx for the same source-of-truth list).
 * Display only; Slice 3 will load these from the `tiers` table.
 */
const STAGE_DEFAULTS: { stage: string; model: ModelName; note: string }[] = [
  { stage: "Classify", model: "haiku", note: "fastest, cheapest" },
  { stage: "JD parser", model: "haiku", note: "fastest, cheapest" },
  { stage: "Tailor", model: "sonnet", note: "balanced" },
  { stage: "Cover letter", model: "sonnet", note: "balanced" },
];

export default function Settings(_props: Props = {}) {
  // Workspace — derived from the browser at mount time. These read-only
  // values are intentionally not persisted; they reflect the live env.
  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const locale = useMemo(() => {
    if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
    return "en-US";
  }, []);

  return (
    <div
      data-testid="settings-route"
      style={{
        height: "100%",
        overflowY: "auto",
        background: "var(--paper)",
        padding: "20px 24px 32px",
      }}
    >
      <PageHeader
        eyebrow="Settings"
        title="The plumbing"
        sub="Workspace, API key, model defaults, exports. Single-tenant — these settings are local to your install."
      />

      <WorkspaceSection timezone={timezone} locale={locale} />
      <ApiKeySection />
      <ModelDefaultsSection />
      <ExportsSection />
      <DangerZoneSection />
    </div>
  );
}

/* ─── Page header ──────────────────────────────────────────────────────── */

function PageHeader({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub: string;
}) {
  return (
    <header style={{ marginBottom: 22 }}>
      <div
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
        }}
      >
        {eyebrow}
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
        {title}
      </h1>
      <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{sub}</div>
    </header>
  );
}

/* ─── Section helper ───────────────────────────────────────────────────── */

function Section({
  title,
  sub,
  children,
  testId,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} style={{ marginBottom: 24 }}>
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

function Card({
  children,
  accent,
  ...rest
}: {
  children: React.ReactNode;
  accent?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        border: `1px solid ${accent ? "var(--accent)" : "var(--rule)"}`,
        background: "var(--paper)",
        padding: 16,
        borderRadius: 3,
        ...(rest.style ?? {}),
      }}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block" }}>
      <div
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 10,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ink-4)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 6 }}>
          {hint}
        </div>
      )}
    </label>
  );
}

/* ─── Workspace ────────────────────────────────────────────────────────── */

function WorkspaceSection({ timezone, locale }: { timezone: string; locale: string }) {
  return (
    <Section
      title="Workspace"
      sub="Read-only — derived from your browser. Single-tenant install."
      testId="settings-workspace"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        <Card>
          <Field label="Time zone">
            <div
              data-testid="settings-timezone"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 13,
                color: "var(--ink)",
              }}
            >
              {timezone}
            </div>
          </Field>
        </Card>
        <Card>
          <Field label="Locale">
            <div
              data-testid="settings-locale"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 13,
                color: "var(--ink)",
              }}
            >
              {locale}
            </div>
          </Field>
        </Card>
        <Card>
          <Field label="Tenant">
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 13,
                color: "var(--ink)",
              }}
            >
              single-tenant · user_id=1
            </div>
          </Field>
        </Card>
      </div>
    </Section>
  );
}

/* ─── API key ──────────────────────────────────────────────────────────── */

function ApiKeySection() {
  // Persist to localStorage only — no fetch ever sends this anywhere.
  // Slice 3 will move provisioning to a server-side `claude_router` config.
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem(API_KEY_STORAGE) ?? "";
    } catch {
      return "";
    }
  });
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const onSave = () => {
    try {
      if (apiKey) localStorage.setItem(API_KEY_STORAGE, apiKey);
      else localStorage.removeItem(API_KEY_STORAGE);
      setSavedAt(Date.now());
    } catch {
      // Best-effort: storage may be disabled in private mode.
    }
  };

  const onClear = () => {
    setApiKey("");
    try {
      localStorage.removeItem(API_KEY_STORAGE);
    } catch {
      /* ignore */
    }
    setSavedAt(Date.now());
  };

  return (
    <Section
      title="Anthropic API key"
      sub="Stored locally only — never sent to the HireScript backend."
      testId="settings-apikey"
    >
      <Card>
        <Field
          label="Key"
          hint="Kept on this device. Slice 3 will move provisioning to server-side claude_router config."
        >
          <input
            type="password"
            data-testid="settings-apikey-input"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-api03-…"
            style={{
              width: "100%",
              fontFamily: "var(--f-mono)",
              fontSize: 12,
              padding: "8px 10px",
              border: "1px solid var(--rule)",
              background: "var(--paper-2)",
              color: "var(--ink)",
              borderRadius: 3,
              boxSizing: "border-box",
            }}
          />
        </Field>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 12,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            data-testid="settings-apikey-save"
            onClick={onSave}
            style={btnStyle("default")}
          >
            Save locally
          </button>
          <button
            type="button"
            data-testid="settings-apikey-clear"
            onClick={onClear}
            style={btnStyle("ghost")}
          >
            Clear
          </button>
          {savedAt && (
            <span
              data-testid="settings-apikey-saved"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                color: "var(--ink-3)",
              }}
            >
              Saved to localStorage
            </span>
          )}
        </div>
      </Card>

      {/* Max subscription placeholder — no backend wiring yet. */}
      <Card style={{ marginTop: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
              }}
            >
              Max subscription
            </div>
            <div
              data-testid="settings-max-status"
              style={{
                marginTop: 6,
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              Not connected · status unknown
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: "var(--ink-3)" }}>
              TODO: Slice 3 — surface real Max-window usage via claude_router.
            </div>
          </div>
          <button
            type="button"
            data-testid="settings-max-connect"
            disabled
            title="Coming in Slice 3"
            style={btnStyle("default", true)}
          >
            Connect Max
          </button>
        </div>
      </Card>
    </Section>
  );
}

/* ─── Model defaults ───────────────────────────────────────────────────── */

function ModelDefaultsSection() {
  return (
    <Section
      title="Model defaults"
      sub="Per-stage models used when no tier policy override applies. Display-only — Tiers govern these in Slice 3."
      testId="settings-models"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        {STAGE_DEFAULTS.map((s) => (
          <Card key={s.stage}>
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
              }}
            >
              {s.stage}
            </div>
            <div
              data-testid={`settings-model-${s.stage.toLowerCase().replace(/\s+/g, "-")}`}
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <ModelBadge model={s.model} size="md" />
              <span
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                }}
              >
                {s.note}
              </span>
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ─── Exports ──────────────────────────────────────────────────────────── */

function ExportsSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadedAt, setDownloadedAt] = useState<number | null>(null);

  const downloadProfile = async () => {
    setBusy(true);
    setError(null);
    try {
      const profile = await api.getProfile();
      const blob = new Blob([JSON.stringify(profile, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hirescript-profile-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloadedAt(Date.now());
    } catch (e: unknown) {
      setError(
        e && typeof e === "object" && "detail" in e
          ? String((e as { detail: unknown }).detail ?? "Profile fetch failed")
          : "Profile fetch failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Exports & backups"
      sub="Download data you own. Resume bundles + history CSV ship in Slice 3."
      testId="settings-exports"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
        }}
      >
        <Card>
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            Profile JSON
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              marginTop: 6,
              lineHeight: 1.6,
            }}
          >
            The structured profile object — projects, experience, skills.
            Re-importable later.
          </div>
          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <button
              type="button"
              data-testid="settings-export-profile"
              onClick={downloadProfile}
              disabled={busy}
              style={btnStyle("default", busy)}
            >
              {busy ? "Preparing…" : "Download JSON"}
            </button>
            {downloadedAt && !error && (
              <span
                data-testid="settings-export-profile-done"
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                }}
              >
                Downloaded
              </span>
            )}
            {error && (
              <span
                data-testid="settings-export-profile-error"
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  color: "var(--accent)",
                }}
              >
                {error}
              </span>
            )}
          </div>
        </Card>

        <Card>
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            Resumes (.zip)
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              marginTop: 6,
              lineHeight: 1.6,
            }}
          >
            Every resume + compiled PDF + variants in one archive.
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              data-testid="settings-export-resumes"
              disabled
              title="Coming in Slice 3"
              style={btnStyle("default", true)}
            >
              Coming in Slice 3
            </button>
          </div>
        </Card>

        <Card>
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            Applications CSV
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              marginTop: 6,
              lineHeight: 1.6,
            }}
          >
            History table flattened for Excel / Sheets.
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              data-testid="settings-export-csv"
              disabled
              title="Coming in Slice 3"
              style={btnStyle("default", true)}
            >
              Coming in Slice 3
            </button>
          </div>
        </Card>
      </div>
    </Section>
  );
}

/* ─── Danger zone ──────────────────────────────────────────────────────── */

function DangerZoneSection() {
  return (
    <Section
      title="Danger zone"
      sub="Destructive actions. Each is gated by typed confirmation."
      testId="settings-danger"
    >
      <div style={{ display: "grid", gap: 12 }}>
        <DangerRow
          testId="danger-kb"
          title="Delete all KB documents"
          body="Removes every document in your knowledge base. Profile fields remain."
          confirmWord="DELETE-KB"
          actionLabel="Delete all KB"
          onConfirm={null}
          disabledNote="No bulk-delete endpoint in Slice 2. Per-document delete is available in Knowledge → Documents. Coming in Slice 3."
        />
        <DangerRow
          testId="danger-wipe"
          title="Wipe browser artifacts"
          body="Clears HireScript localStorage entries on this device (theme, API key). Server-side data is untouched."
          confirmWord="WIPE"
          actionLabel="Wipe local storage"
          onConfirm={() => {
            for (const k of APP_LOCALSTORAGE_KEYS) {
              try {
                localStorage.removeItem(k);
              } catch {
                /* ignore */
              }
            }
          }}
        />
      </div>
    </Section>
  );
}

function DangerRow({
  testId,
  title,
  body,
  confirmWord,
  actionLabel,
  onConfirm,
  disabledNote,
}: {
  testId: string;
  title: string;
  body: string;
  confirmWord: string;
  actionLabel: string;
  onConfirm: (() => void) | null;
  disabledNote?: string;
}) {
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);

  const matched = typed === confirmWord;
  const enabled = matched && onConfirm !== null;

  return (
    <Card accent data-testid={testId}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 600, color: "var(--accent)" }}>{title}</div>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              marginTop: 4,
              lineHeight: 1.6,
            }}
          >
            {body}
          </div>
          {disabledNote && (
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                marginTop: 6,
                fontFamily: "var(--f-mono)",
              }}
            >
              {disabledNote}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            data-testid={`${testId}-input`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`type ${confirmWord}`}
            disabled={onConfirm === null}
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 12,
              padding: "6px 10px",
              border: "1px solid var(--rule)",
              background: "var(--paper-2)",
              color: "var(--ink)",
              borderRadius: 3,
              width: 180,
            }}
          />
          <button
            type="button"
            data-testid={`${testId}-action`}
            disabled={!enabled}
            onClick={() => {
              if (!enabled) return;
              onConfirm!();
              setDone(true);
              setTyped("");
            }}
            style={btnStyle("danger", !enabled)}
          >
            {actionLabel}
          </button>
          {done && (
            <span
              data-testid={`${testId}-done`}
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                color: "var(--ink-3)",
              }}
            >
              Done
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ─── Buttons ──────────────────────────────────────────────────────────── */

function btnStyle(
  kind: "default" | "ghost" | "danger",
  disabled: boolean = false,
): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: "var(--f-mono)",
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 3,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    border: "1px solid var(--rule)",
    background: "var(--paper-2)",
    color: "var(--ink)",
  };
  if (kind === "ghost") {
    return { ...base, background: "transparent", border: "1px solid transparent", color: "var(--ink-3)" };
  }
  if (kind === "danger") {
    return {
      ...base,
      border: "1px solid var(--accent)",
      background: disabled ? "var(--paper-2)" : "var(--accent)",
      color: disabled ? "var(--ink-3)" : "var(--paper)",
    };
  }
  return base;
}
