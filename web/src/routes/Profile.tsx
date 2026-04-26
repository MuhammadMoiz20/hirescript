import { useEffect, useMemo, useState } from "react";
import {
  api,
  CompanyStage,
  Education,
  EmploymentType,
  Position,
  Profile as ProfileType,
  WorkMode,
} from "../api";
import TopChrome from "../components/ui/TopChrome";
import Button from "../components/ui/Button";

type FieldErrors = Record<string, string>;

const COMPANY_STAGES: CompanyStage[] = [
  "pre_seed", "seed", "series_a", "series_b_plus", "public",
];
const WORK_MODES: WorkMode[] = ["remote", "hybrid", "onsite"];
const EMPLOYMENT_TYPES: EmploymentType[] = ["full_time", "contract", "internship"];

function emptyProfile(): ProfileType {
  return {
    legal_name: "",
    preferred_name: null,
    email: "",
    phone: null,
    address: null,
    links: {},
    work_auth: { citizenships: [], sponsorship_needed: {}, relocate_to: [] },
    positions: [],
    education: [],
    languages: [],
    preferences: {
      salary_floor_usd: null,
      salary_target_usd: null,
      role_families: [],
      dealbreakers: [],
      company_stages: [],
      work_modes: [],
      cover_letter_default: true,
      disclose_salary_default: false,
    },
    eeo: { gender: null, race_ethnicity: null, veteran: null, disability: null },
    kill_list: [],
  };
}

function parseFieldErrors(detail: any): { fields: FieldErrors; generic: string | null } {
  const fields: FieldErrors = {};
  let generic: string | null = null;
  if (Array.isArray(detail)) {
    for (const item of detail) {
      const loc = Array.isArray(item?.loc) ? item.loc.slice(1) : [];
      const key = loc.join(".");
      if (key) fields[key] = item.msg ?? "Invalid value";
      else generic = item.msg ?? generic;
    }
  } else if (typeof detail === "string") {
    generic = detail;
  } else if (detail && typeof detail.message === "string") {
    generic = detail.message;
  }
  return { fields, generic };
}

// ── Tiny styled primitives kept local to this route ─────────────────────────

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section
      style={{
        border: "1px solid var(--rule)",
        background: "var(--paper)",
        borderRadius: 4,
        padding: 18,
        marginBottom: 14,
      }}
    >
      <h2
        style={{
          fontFamily: "var(--f-serif)",
          fontSize: 18,
          letterSpacing: "-0.01em",
          margin: "0 0 4px",
        }}
      >
        {title}
      </h2>
      {hint && <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--ink-3)" }}>{hint}</p>}
      {!hint && <div style={{ height: 10 }} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}

function LabelRow({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
}) {
  // When `htmlFor` points to a single labelable element, render a real <label>.
  // For section/group headings (e.g. chip groups, toggle groups) there is no
  // single labelable target, so render a <div> with the same eyebrow styling
  // to avoid a broken label association for screen readers and click handling.
  const headingStyle: React.CSSProperties = { display: "block", marginBottom: 6 };
  return (
    <div>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="eyebrow" style={headingStyle}>
          {label}
        </label>
      ) : (
        <div className="eyebrow" style={headingStyle}>
          {label}
        </div>
      )}
      {children}
      {error && (
        <div
          id={htmlFor ? `${htmlFor}-error` : undefined}
          role="alert"
          style={{ marginTop: 4, fontSize: 12, color: "var(--accent)" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

const inputBase: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--rule-strong)",
  background: "var(--paper)",
  color: "var(--ink)",
  borderRadius: 3,
  padding: "7px 10px",
  fontSize: 13,
  fontFamily: "var(--f-sans)",
  outline: "none",
  boxSizing: "border-box",
};

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, style, ...rest } = props;
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      style={{
        ...inputBase,
        borderColor: invalid ? "var(--accent)" : "var(--rule-strong)",
        ...style,
      }}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { style, ...rest } = props;
  return (
    <textarea
      {...rest}
      style={{ ...inputBase, minHeight: 64, resize: "vertical", ...style }}
    />
  );
}

function Chips({
  values,
  onAdd,
  onRemove,
  placeholder,
  ariaLabel,
}: {
  values: string[];
  onAdd: (v: string) => void;
  onRemove: (idx: number) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 8px",
              border: "1px solid var(--rule-strong)",
              borderRadius: 999,
              fontSize: 12,
              background: "var(--paper-2)",
            }}
          >
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onRemove(i)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--ink-3)",
                fontSize: 12,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>None</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          aria-label={ariaLabel}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) {
                onAdd(draft.trim());
                setDraft("");
              }
            }
          }}
          style={{ ...inputBase, flex: 1 }}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => {
            if (draft.trim()) {
              onAdd(draft.trim());
              setDraft("");
            }
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function ToggleChips<T extends string>({
  options,
  selected,
  onToggle,
}: {
  options: T[];
  selected: T[];
  onToggle: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            type="button"
            key={opt}
            onClick={() => onToggle(opt)}
            aria-pressed={on}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid " + (on ? "var(--ink)" : "var(--rule-strong)"),
              background: on ? "var(--ink)" : "var(--paper)",
              color: on ? "var(--paper)" : "var(--ink)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {opt.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface Props {
  onBack?: () => void;
}

export default function Profile({ onBack }: Props) {
  const [profile, setProfile] = useState<ProfileType | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [genericError, setGenericError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getProfile()
      .then((p) => {
        if (!alive) return;
        // If the email is the empty shell, clear it for editing.
        const next: ProfileType = { ...emptyProfile(), ...p };
        // Backend GET /profile returns {"legal_name": "", "email": "unset@example.com"}
        // when no profile row exists (see api/app/routes/profile.py EMPTY_SHELL).
        // Clear the sentinel so the user starts with a blank email field on first visit.
        // TODO(slice-2): replace with a server-side "profile_set: bool" flag so the
        // frontend doesn't have to know the backend's sentinel value.
        if (p.email === "unset@example.com" && p.legal_name === "") next.email = "";
        setProfile(next);
        setLoading(false);
      })
      .catch((e: any) => {
        if (!alive) return;
        setLoadError(e?.detail ? String(e.detail) : e?.message || "Failed to load profile");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function update<K extends keyof ProfileType>(key: K, value: ProfileType[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
    setDirty(true);
    setSaved(false);
  }

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setGenericError(null);
    setErrors({});
    try {
      const saved = await api.putProfile(profile);
      setProfile({ ...emptyProfile(), ...saved });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      if (e?.status === 422) {
        const { fields, generic } = parseFieldErrors(e.detail);
        setErrors(fields);
        setGenericError(generic);
      } else {
        setGenericError(e?.detail?.message || e?.message || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  const linkRows = useMemo(
    () => (profile ? Object.entries(profile.links) : []),
    [profile],
  );

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
        <TopChrome onLogoClick={onBack}>Profile</TopChrome>
        <div style={{ padding: 24, color: "var(--ink-3)", fontSize: 13 }}>Loading profile…</div>
      </div>
    );
  }

  if (loadError || !profile) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
        <TopChrome onLogoClick={onBack}>Profile</TopChrome>
        <div style={{ padding: 24 }}>
          <div role="alert" style={{ color: "var(--accent)", fontSize: 13 }}>
            {loadError || "Profile unavailable"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome onLogoClick={onBack}>Profile</TopChrome>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "clamp(16px, 3vw, 24px)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 20,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Account</div>
              <h1
                style={{
                  fontFamily: "var(--f-serif)",
                  fontSize: 26,
                  letterSpacing: "-0.02em",
                  margin: 0,
                }}
              >
                Profile
              </h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {saved && (
                <span
                  role="status"
                  style={{ fontSize: 12, color: "var(--ink-2)" }}
                >
                  Saved
                </span>
              )}
              <Button variant="primary" onClick={handleSave} disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>

          {genericError && (
            <div
              role="alert"
              style={{
                border: "1px solid var(--accent)",
                background: "color-mix(in oklch, var(--accent) 10%, var(--paper))",
                color: "var(--ink)",
                padding: "8px 12px",
                borderRadius: 3,
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              {genericError}
            </div>
          )}

          <Section title="Identity">
            <LabelRow label="Legal name" htmlFor="legal_name" error={errors["legal_name"]}>
              <TextInput
                id="legal_name"
                value={profile.legal_name}
                invalid={!!errors["legal_name"]}
                onChange={(e) => update("legal_name", e.target.value)}
              />
            </LabelRow>
            <LabelRow label="Preferred name" htmlFor="preferred_name" error={errors["preferred_name"]}>
              <TextInput
                id="preferred_name"
                value={profile.preferred_name ?? ""}
                onChange={(e) => update("preferred_name", e.target.value || null)}
              />
            </LabelRow>
            <LabelRow label="Email" htmlFor="email" error={errors["email"]}>
              <TextInput
                id="email"
                type="email"
                value={profile.email}
                invalid={!!errors["email"]}
                onChange={(e) => update("email", e.target.value)}
              />
            </LabelRow>
            <LabelRow label="Phone" htmlFor="phone" error={errors["phone"]}>
              <TextInput
                id="phone"
                type="tel"
                value={profile.phone ?? ""}
                onChange={(e) => update("phone", e.target.value || null)}
              />
            </LabelRow>
            <LabelRow label="Address" htmlFor="address" error={errors["address"]}>
              <TextArea
                id="address"
                value={profile.address ?? ""}
                onChange={(e) => update("address", e.target.value || null)}
              />
            </LabelRow>
          </Section>

          <Section title="Links" hint="Key/value pairs (e.g. github → https://github.com/you).">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {linkRows.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>No links yet.</div>
              )}
              {linkRows.map(([k, v], idx) => (
                <div key={idx} style={{ display: "flex", gap: 6 }}>
                  <TextInput
                    aria-label={`Link key ${idx + 1}`}
                    value={k}
                    placeholder="key"
                    onChange={(e) => {
                      const newKey = e.target.value;
                      const next: Record<string, string> = {};
                      Object.entries(profile.links).forEach(([kk, vv], i) => {
                        next[i === idx ? newKey : kk] = vv;
                      });
                      update("links", next);
                    }}
                    style={{ maxWidth: 180 }}
                  />
                  <TextInput
                    aria-label={`Link value ${idx + 1}`}
                    value={v}
                    placeholder="https://…"
                    onChange={(e) => {
                      update("links", { ...profile.links, [k]: e.target.value });
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const next = { ...profile.links };
                      delete next[k];
                      update("links", next);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  size="sm"
                  icon="plus"
                  onClick={() => {
                    let key = "new_link";
                    let n = 1;
                    while (Object.prototype.hasOwnProperty.call(profile.links, key)) {
                      key = `new_link_${++n}`;
                    }
                    update("links", { ...profile.links, [key]: "" });
                  }}
                >
                  Add Link
                </Button>
              </div>
            </div>
          </Section>

          <Section title="Work authorization">
            <LabelRow label="Citizenships">
              <Chips
                ariaLabel="Add citizenship"
                placeholder="e.g. US"
                values={profile.work_auth.citizenships}
                onAdd={(v) =>
                  update("work_auth", {
                    ...profile.work_auth,
                    citizenships: [...profile.work_auth.citizenships, v],
                  })
                }
                onRemove={(i) =>
                  update("work_auth", {
                    ...profile.work_auth,
                    citizenships: profile.work_auth.citizenships.filter((_, x) => x !== i),
                  })
                }
              />
            </LabelRow>
            <LabelRow label="Sponsorship needed (country → yes/no)">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(profile.work_auth.sponsorship_needed).map(([country, val], idx) => (
                  <div key={`${country}-${idx}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <TextInput
                      aria-label={`Sponsorship country ${idx + 1}`}
                      value={country}
                      placeholder="country code"
                      onChange={(e) => {
                        const newKey = e.target.value;
                        const next: Record<string, boolean> = {};
                        Object.entries(profile.work_auth.sponsorship_needed).forEach(
                          ([kk, vv], i) => {
                            next[i === idx ? newKey : kk] = vv;
                          },
                        );
                        update("work_auth", { ...profile.work_auth, sponsorship_needed: next });
                      }}
                      style={{ maxWidth: 180 }}
                    />
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        color: "var(--ink-2)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={val}
                        onChange={(e) =>
                          update("work_auth", {
                            ...profile.work_auth,
                            sponsorship_needed: {
                              ...profile.work_auth.sponsorship_needed,
                              [country]: e.target.checked,
                            },
                          })
                        }
                      />
                      Needs sponsorship
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const next = { ...profile.work_auth.sponsorship_needed };
                        delete next[country];
                        update("work_auth", { ...profile.work_auth, sponsorship_needed: next });
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    size="sm"
                    icon="plus"
                    onClick={() => {
                      let key = "XX";
                      let n = 1;
                      while (
                        Object.prototype.hasOwnProperty.call(
                          profile.work_auth.sponsorship_needed,
                          key,
                        )
                      ) {
                        key = `XX_${++n}`;
                      }
                      update("work_auth", {
                        ...profile.work_auth,
                        sponsorship_needed: { ...profile.work_auth.sponsorship_needed, [key]: false },
                      });
                    }}
                  >
                    Add country
                  </Button>
                </div>
              </div>
            </LabelRow>
            <LabelRow label="Open to relocate">
              <Chips
                ariaLabel="Add relocate destination"
                values={profile.work_auth.relocate_to}
                onAdd={(v) =>
                  update("work_auth", {
                    ...profile.work_auth,
                    relocate_to: [...profile.work_auth.relocate_to, v],
                  })
                }
                onRemove={(i) =>
                  update("work_auth", {
                    ...profile.work_auth,
                    relocate_to: profile.work_auth.relocate_to.filter((_, x) => x !== i),
                  })
                }
              />
            </LabelRow>
          </Section>

          <Section title="Positions">
            {profile.positions.map((p, idx) => (
              <PositionCard
                key={idx}
                value={p}
                errors={errors}
                pathPrefix={`positions.${idx}`}
                onChange={(next) => {
                  const arr = [...profile.positions];
                  arr[idx] = next;
                  update("positions", arr);
                }}
                onRemove={() =>
                  update(
                    "positions",
                    profile.positions.filter((_, i) => i !== idx),
                  )
                }
              />
            ))}
            <div>
              <Button
                type="button"
                size="sm"
                icon="plus"
                onClick={() =>
                  update("positions", [
                    ...profile.positions,
                    {
                      company: "",
                      title: "",
                      start: new Date().toISOString().slice(0, 10),
                      end: null,
                      location: null,
                      employment_type: "full_time",
                      description: null,
                    },
                  ])
                }
              >
                Add position
              </Button>
            </div>
          </Section>

          <Section title="Education">
            {profile.education.map((e, idx) => (
              <EducationCard
                key={idx}
                value={e}
                errors={errors}
                pathPrefix={`education.${idx}`}
                onChange={(next) => {
                  const arr = [...profile.education];
                  arr[idx] = next;
                  update("education", arr);
                }}
                onRemove={() =>
                  update(
                    "education",
                    profile.education.filter((_, i) => i !== idx),
                  )
                }
              />
            ))}
            <div>
              <Button
                type="button"
                size="sm"
                icon="plus"
                onClick={() =>
                  update("education", [
                    ...profile.education,
                    { institution: "", degree: "", field: null, start: null, end: null },
                  ])
                }
              >
                Add education
              </Button>
            </div>
          </Section>

          <Section title="Languages">
            <Chips
              ariaLabel="Add language"
              values={profile.languages}
              onAdd={(v) => update("languages", [...profile.languages, v])}
              onRemove={(i) => update("languages", profile.languages.filter((_, x) => x !== i))}
            />
          </Section>

          <Section title="Preferences">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <LabelRow label="Salary floor (USD)" htmlFor="salary_floor">
                <TextInput
                  id="salary_floor"
                  type="number"
                  value={profile.preferences.salary_floor_usd ?? ""}
                  onChange={(e) =>
                    update("preferences", {
                      ...profile.preferences,
                      salary_floor_usd: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </LabelRow>
              <LabelRow label="Salary target (USD)" htmlFor="salary_target">
                <TextInput
                  id="salary_target"
                  type="number"
                  value={profile.preferences.salary_target_usd ?? ""}
                  onChange={(e) =>
                    update("preferences", {
                      ...profile.preferences,
                      salary_target_usd: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </LabelRow>
            </div>
            <LabelRow label="Role families">
              <Chips
                ariaLabel="Add role family"
                values={profile.preferences.role_families}
                onAdd={(v) =>
                  update("preferences", {
                    ...profile.preferences,
                    role_families: [...profile.preferences.role_families, v],
                  })
                }
                onRemove={(i) =>
                  update("preferences", {
                    ...profile.preferences,
                    role_families: profile.preferences.role_families.filter((_, x) => x !== i),
                  })
                }
              />
            </LabelRow>
            <LabelRow label="Dealbreakers">
              <Chips
                ariaLabel="Add dealbreaker"
                values={profile.preferences.dealbreakers}
                onAdd={(v) =>
                  update("preferences", {
                    ...profile.preferences,
                    dealbreakers: [...profile.preferences.dealbreakers, v],
                  })
                }
                onRemove={(i) =>
                  update("preferences", {
                    ...profile.preferences,
                    dealbreakers: profile.preferences.dealbreakers.filter((_, x) => x !== i),
                  })
                }
              />
            </LabelRow>
            <LabelRow label="Company stages">
              <ToggleChips
                options={COMPANY_STAGES}
                selected={profile.preferences.company_stages}
                onToggle={(v) => {
                  const cur = profile.preferences.company_stages;
                  update("preferences", {
                    ...profile.preferences,
                    company_stages: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
                  });
                }}
              />
            </LabelRow>
            <LabelRow label="Work modes">
              <ToggleChips
                options={WORK_MODES}
                selected={profile.preferences.work_modes}
                onToggle={(v) => {
                  const cur = profile.preferences.work_modes;
                  update("preferences", {
                    ...profile.preferences,
                    work_modes: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
                  });
                }}
              />
            </LabelRow>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, color: "var(--ink-2)" }}>
                <input
                  type="checkbox"
                  checked={profile.preferences.cover_letter_default}
                  onChange={(e) =>
                    update("preferences", {
                      ...profile.preferences,
                      cover_letter_default: e.target.checked,
                    })
                  }
                  style={{ marginRight: 8 }}
                />
                Generate a cover letter by default
              </label>
              <label style={{ fontSize: 13, color: "var(--ink-2)" }}>
                <input
                  type="checkbox"
                  checked={profile.preferences.disclose_salary_default}
                  onChange={(e) =>
                    update("preferences", {
                      ...profile.preferences,
                      disclose_salary_default: e.target.checked,
                    })
                  }
                  style={{ marginRight: 8 }}
                />
                Disclose salary expectations by default
              </label>
            </div>
          </Section>

          <Section
            title="EEO defaults"
            hint="All defaults are optional and only used to pre-fill ATS forms."
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <LabelRow label="Gender" htmlFor="eeo_gender">
                <TextInput
                  id="eeo_gender"
                  value={profile.eeo.gender ?? ""}
                  onChange={(e) =>
                    update("eeo", { ...profile.eeo, gender: e.target.value || null })
                  }
                />
              </LabelRow>
              <LabelRow label="Race / ethnicity" htmlFor="eeo_race">
                <TextInput
                  id="eeo_race"
                  value={profile.eeo.race_ethnicity ?? ""}
                  onChange={(e) =>
                    update("eeo", { ...profile.eeo, race_ethnicity: e.target.value || null })
                  }
                />
              </LabelRow>
              <LabelRow label="Veteran status" htmlFor="eeo_vet">
                <TextInput
                  id="eeo_vet"
                  value={profile.eeo.veteran ?? ""}
                  onChange={(e) =>
                    update("eeo", { ...profile.eeo, veteran: e.target.value || null })
                  }
                />
              </LabelRow>
              <LabelRow label="Disability" htmlFor="eeo_dis">
                <TextInput
                  id="eeo_dis"
                  value={profile.eeo.disability ?? ""}
                  onChange={(e) =>
                    update("eeo", { ...profile.eeo, disability: e.target.value || null })
                  }
                />
              </LabelRow>
            </div>
          </Section>

          <Section title="Kill list" hint="Companies you never want tailored applications for.">
            <Chips
              ariaLabel="Add company to kill list"
              values={profile.kill_list}
              onAdd={(v) => update("kill_list", [...profile.kill_list, v])}
              onRemove={(i) => update("kill_list", profile.kill_list.filter((_, x) => x !== i))}
            />
          </Section>

          <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0 32px" }}>
            <Button variant="primary" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PositionCard({
  value,
  errors,
  pathPrefix,
  onChange,
  onRemove,
}: {
  value: Position;
  errors: FieldErrors;
  pathPrefix: string;
  onChange: (next: Position) => void;
  onRemove: () => void;
}) {
  const err = (k: string) => errors[`${pathPrefix}.${k}`];
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 3,
        padding: 12,
        background: "var(--paper-2)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <LabelRow label="Company" htmlFor={`${pathPrefix}-company`} error={err("company")}>
          <TextInput
            id={`${pathPrefix}-company`}
            value={value.company}
            invalid={!!err("company")}
            onChange={(e) => onChange({ ...value, company: e.target.value })}
          />
        </LabelRow>
        <LabelRow label="Title" htmlFor={`${pathPrefix}-title`} error={err("title")}>
          <TextInput
            id={`${pathPrefix}-title`}
            value={value.title}
            invalid={!!err("title")}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
        </LabelRow>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <LabelRow label="Start" htmlFor={`${pathPrefix}-start`} error={err("start")}>
          <TextInput
            id={`${pathPrefix}-start`}
            type="date"
            value={value.start ?? ""}
            invalid={!!err("start")}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
          />
        </LabelRow>
        <LabelRow label="End" htmlFor={`${pathPrefix}-end`} error={err("end")}>
          <TextInput
            id={`${pathPrefix}-end`}
            type="date"
            value={value.end ?? ""}
            onChange={(e) => onChange({ ...value, end: e.target.value || null })}
          />
        </LabelRow>
        <LabelRow label="Location" htmlFor={`${pathPrefix}-loc`}>
          <TextInput
            id={`${pathPrefix}-loc`}
            value={value.location ?? ""}
            onChange={(e) => onChange({ ...value, location: e.target.value || null })}
          />
        </LabelRow>
      </div>
      <LabelRow label="Employment type" htmlFor={`${pathPrefix}-type`}>
        <select
          id={`${pathPrefix}-type`}
          value={value.employment_type}
          onChange={(e) =>
            onChange({ ...value, employment_type: e.target.value as EmploymentType })
          }
          style={{ ...inputBase, width: "auto" }}
        >
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace("_", " ")}
            </option>
          ))}
        </select>
      </LabelRow>
      <LabelRow label="Description" htmlFor={`${pathPrefix}-desc`}>
        <TextArea
          id={`${pathPrefix}-desc`}
          value={value.description ?? ""}
          onChange={(e) => onChange({ ...value, description: e.target.value || null })}
        />
      </LabelRow>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove position
        </Button>
      </div>
    </div>
  );
}

function EducationCard({
  value,
  errors,
  pathPrefix,
  onChange,
  onRemove,
}: {
  value: Education;
  errors: FieldErrors;
  pathPrefix: string;
  onChange: (next: Education) => void;
  onRemove: () => void;
}) {
  const err = (k: string) => errors[`${pathPrefix}.${k}`];
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 3,
        padding: 12,
        background: "var(--paper-2)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <LabelRow label="Institution" htmlFor={`${pathPrefix}-inst`} error={err("institution")}>
          <TextInput
            id={`${pathPrefix}-inst`}
            value={value.institution}
            invalid={!!err("institution")}
            onChange={(e) => onChange({ ...value, institution: e.target.value })}
          />
        </LabelRow>
        <LabelRow label="Degree" htmlFor={`${pathPrefix}-deg`} error={err("degree")}>
          <TextInput
            id={`${pathPrefix}-deg`}
            value={value.degree}
            invalid={!!err("degree")}
            onChange={(e) => onChange({ ...value, degree: e.target.value })}
          />
        </LabelRow>
      </div>
      <LabelRow label="Field" htmlFor={`${pathPrefix}-field`}>
        <TextInput
          id={`${pathPrefix}-field`}
          value={value.field ?? ""}
          onChange={(e) => onChange({ ...value, field: e.target.value || null })}
        />
      </LabelRow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <LabelRow label="Start" htmlFor={`${pathPrefix}-start`}>
          <TextInput
            id={`${pathPrefix}-start`}
            type="date"
            value={value.start ?? ""}
            onChange={(e) => onChange({ ...value, start: e.target.value || null })}
          />
        </LabelRow>
        <LabelRow label="End" htmlFor={`${pathPrefix}-end`}>
          <TextInput
            id={`${pathPrefix}-end`}
            type="date"
            value={value.end ?? ""}
            onChange={(e) => onChange({ ...value, end: e.target.value || null })}
          />
        </LabelRow>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove education
        </Button>
      </div>
    </div>
  );
}
