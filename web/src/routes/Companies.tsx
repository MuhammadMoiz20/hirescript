/**
 * Companies — admin page for the source allowlist (slice 4).
 *
 * Reachable as a sibling surface under Settings (App.tsx adds a `companies`
 * View). Lists every `Company` row from the backend, grouped by source. A
 * row exposes an enabled-toggle (PATCH) and a delete button (DELETE, soft).
 * The bottom form POSTs a new `(source, slug, display_name)` triple — the
 * backend runs a sanity-check fetch and returns 422 with `detail` if the
 * slug yields zero postings.
 *
 * Visual treatment mirrors `Tiers.tsx` / `Settings.tsx` — eyebrow + serif
 * page header, paper-card surfaces, mono labels for system metadata.
 */
import { useEffect, useMemo, useState } from "react";
import { api, type Company, type CompanySource } from "../api";
import Button from "../components/ui/Button";

interface Props {
  onBack?: () => void;
}

const SOURCES: { id: CompanySource; label: string }[] = [
  { id: "greenhouse", label: "Greenhouse" },
  { id: "lever", label: "Lever" },
  { id: "ashby", label: "Ashby" },
  { id: "workable", label: "Workable" },
];

export default function Companies(_props: Props = {}) {
  const [rows, setRows] = useState<Company[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listCompanies()
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setLoadError(
          e?.detail ? String(e.detail) : e?.message || "Failed to load companies",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const out: Record<string, Company[]> = {};
    for (const c of rows ?? []) {
      (out[c.source] ||= []).push(c);
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => a.display_name.localeCompare(b.display_name));
    }
    return out;
  }, [rows]);

  function handleToggle(c: Company) {
    if (!rows) return;
    const next = !c.enabled;
    // Optimistic update.
    setRows(rows.map((r) => (r.id === c.id ? { ...r, enabled: next } : r)));
    api
      .updateCompany(c.id, { enabled: next })
      .then((updated) => {
        setRows((prev) =>
          (prev ?? []).map((r) => (r.id === c.id ? updated : r)),
        );
      })
      .catch(() => {
        // Rollback.
        setRows((prev) =>
          (prev ?? []).map((r) => (r.id === c.id ? { ...r, enabled: c.enabled } : r)),
        );
      });
  }

  function handleDelete(c: Company) {
    if (!rows) return;
    const snapshot = rows;
    setRows(rows.filter((r) => r.id !== c.id));
    api.deleteCompany(c.id).catch(() => {
      setRows(snapshot);
    });
  }

  function handleAdded(created: Company) {
    setRows((prev) => [...(prev ?? []), created]);
  }

  return (
    <div
      data-testid="companies-route"
      style={{
        height: "100%",
        overflowY: "auto",
        background: "var(--paper)",
        padding: "20px 24px 32px",
      }}
    >
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
          Settings · Companies
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
          Source allowlist
        </h1>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
          Companies the scheduler polls every tick. Disable to pause; delete to
          soft-remove (postings already ingested are kept).
        </div>
      </header>

      {loadError && (
        <div
          role="alert"
          data-testid="companies-load-error"
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

      {rows === null ? (
        <div
          data-testid="companies-loading"
          style={{
            padding: 24,
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          loading…
        </div>
      ) : rows.length === 0 ? (
        <div
          data-testid="companies-empty"
          style={{
            padding: 24,
            border: "1px dashed var(--rule)",
            borderRadius: 3,
            color: "var(--ink-3)",
            fontSize: 13,
          }}
        >
          No companies yet — add one below.
        </div>
      ) : (
        SOURCES.filter((s) => (grouped[s.id] ?? []).length > 0).map((s) => (
          <SourceGroup
            key={s.id}
            source={s.id}
            label={s.label}
            companies={grouped[s.id] ?? []}
            onToggle={handleToggle}
            onDelete={handleDelete}
          />
        ))
      )}

      <AddCompanyForm onAdded={handleAdded} />
    </div>
  );
}

function SourceGroup({
  source,
  label,
  companies,
  onToggle,
  onDelete,
}: {
  source: string;
  label: string;
  companies: Company[];
  onToggle: (c: Company) => void;
  onDelete: (c: Company) => void;
}) {
  return (
    <section
      data-testid={`companies-group-${source}`}
      style={{ marginBottom: 24 }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--f-serif)",
            fontSize: 16,
            margin: 0,
            color: "var(--ink)",
          }}
        >
          {label}
        </h2>
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-4)" }}
        >
          {companies.length} compan{companies.length === 1 ? "y" : "ies"}
        </span>
      </header>
      <div
        style={{
          border: "1px solid var(--rule)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          role="row"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(180px, 1.4fr) minmax(140px, 1fr) 90px 80px",
            gap: 12,
            padding: "8px 14px",
            background: "var(--paper-2)",
            fontFamily: "var(--f-mono)",
            fontSize: 10,
            color: "var(--ink-4)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <span>Display name</span>
          <span>Slug</span>
          <span>Enabled</span>
          <span style={{ textAlign: "right" }}>Actions</span>
        </div>
        {companies.map((c) => (
          <div
            key={c.id}
            role="row"
            data-testid={`company-row-${c.id}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, 1.4fr) minmax(140px, 1fr) 90px 80px",
              gap: 12,
              padding: "10px 14px",
              alignItems: "center",
              borderBottom: "1px solid var(--rule)",
              background: "var(--paper)",
            }}
          >
            <span style={{ fontSize: 13, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {c.display_name}
              {c.discovered_by === "agent" && (
                <span
                  data-testid={`company-proposed-${c.id}`}
                  title={c.discovery_rationale || "Proposed by the discovery agent."}
                  style={{
                    fontFamily: "var(--f-mono)",
                    fontSize: 9,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    padding: "1px 5px",
                    border: "1px solid var(--accent)",
                    color: "var(--accent)",
                    borderRadius: 2,
                  }}
                >
                  Proposed
                </span>
              )}
            </span>
            <span
              className="mono"
              style={{ fontSize: 12, color: "var(--ink-3)" }}
            >
              {c.slug}
            </span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                data-testid={`company-toggle-${c.id}`}
                checked={c.enabled}
                onChange={() => onToggle(c)}
              />
              <span
                className="mono"
                style={{ fontSize: 11, color: c.enabled ? "var(--ink-2)" : "var(--ink-4)" }}
              >
                {c.enabled ? "on" : "off"}
              </span>
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                size="sm"
                variant="ghost"
                data-testid={`company-delete-${c.id}`}
                onClick={() => onDelete(c)}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AddCompanyForm({ onAdded }: { onAdded: (c: Company) => void }) {
  const [source, setSource] = useState<CompanySource>("greenhouse");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = slug.trim() && name.trim() && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createCompany({
        source,
        slug: slug.trim(),
        display_name: name.trim(),
      });
      onAdded(created);
      setSlug("");
      setName("");
    } catch (e: any) {
      setError(
        e?.detail ? String(e.detail) : e?.message || "Failed to add company",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section style={{ marginTop: 32 }}>
      <header style={{ marginBottom: 8 }}>
        <h2
          style={{
            fontFamily: "var(--f-serif)",
            fontSize: 16,
            margin: 0,
            color: "var(--ink)",
          }}
        >
          Add company
        </h2>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
          The backend runs a sanity-check fetch — if the slug yields zero
          postings the row is rejected.
        </div>
      </header>
      <form
        onSubmit={handleSubmit}
        style={{
          display: "grid",
          gridTemplateColumns: "160px 1fr 1fr auto",
          gap: 8,
          alignItems: "end",
          padding: 14,
          border: "1px solid var(--rule)",
          background: "var(--paper-2)",
          borderRadius: 3,
        }}
      >
        <FormField label="Source">
          <select
            data-testid="companies-add-source"
            value={source}
            onChange={(e) => setSource(e.target.value as CompanySource)}
            style={inputStyle}
          >
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Slug">
          <input
            type="text"
            data-testid="companies-add-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="anthropic"
            style={inputStyle}
          />
        </FormField>
        <FormField label="Display name">
          <input
            type="text"
            data-testid="companies-add-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anthropic"
            style={inputStyle}
          />
        </FormField>
        <Button
          type="submit"
          variant="primary"
          size="md"
          data-testid="companies-add-submit"
          disabled={!canSubmit}
        >
          {submitting ? "Adding…" : "Add"}
        </Button>
      </form>
      {error && (
        <div
          role="alert"
          data-testid="companies-add-error"
          style={{
            marginTop: 8,
            border: "1px solid var(--err)",
            background: "color-mix(in oklch, var(--err) 10%, var(--paper))",
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--ink)",
            borderRadius: 3,
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
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
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontFamily: "var(--f-mono)",
  fontSize: 12,
  padding: "6px 10px",
  border: "1px solid var(--rule)",
  background: "var(--paper)",
  color: "var(--ink)",
  borderRadius: 3,
  boxSizing: "border-box",
};
