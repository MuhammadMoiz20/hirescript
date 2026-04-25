import { useEffect, useState } from "react";
import { api, ResumeOut, SectionsPayload } from "../api";
import Button from "./ui/Button";
import Field from "./ui/Field";
import Input from "./ui/Input";
import Textarea from "./ui/Textarea";
import Glyph from "./ui/Glyph";

interface Props {
  resumeId: number;
  payload: SectionsPayload;
  onSaved: (resume: ResumeOut) => void;
  /** Optional: lift content state to the parent so the editor toolbar
   *  Save / Compile buttons can act on the latest form state. */
  onContentChange?: (content: any) => void;
}

type Contact = { label: string; value: string; url: string };
type SubheadingRow = {
  institution: string;
  location: string;
  degree: string;
  date: string;
  bullets: string[];
};
type ProjectRow = { name: string; tech: string; date: string; bullets: string[] };

const sectionStyle: React.CSSProperties = {
  padding: "16px 18px",
  borderBottom: "1px solid var(--rule)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const sectionHeading: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--f-serif)",
  fontSize: 18,
  fontWeight: 600,
  color: "var(--ink)",
  letterSpacing: "-0.005em",
};

const rowCard: React.CSSProperties = {
  border: "1px solid var(--rule)",
  borderRadius: 4,
  padding: 12,
  background: "var(--paper)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const fieldGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
};

export default function SectionFormEditor({
  resumeId,
  payload,
  onSaved,
  onContentChange,
}: Props) {
  const [content, setContent] = useState<any>(() =>
    JSON.parse(JSON.stringify(payload.content_json)),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Notify the parent on every change so the toolbar Save/Compile are honest.
  useEffect(() => {
    onContentChange?.(content);
  }, [content, onContentChange]);

  // When a fresh payload arrives (e.g. after a rollback or AI accept), reset.
  useEffect(() => {
    setContent(JSON.parse(JSON.stringify(payload.content_json)));
  }, [payload]);

  const schema = payload.schema;
  const subheadingFields = schema.subheading_fields || {
    institution: "Institution",
    location: "Location",
    degree: "Title / Degree",
    date: "Date",
  };
  const projectFields = schema.project_fields || {
    name: "Name",
    tech: "Tech",
    date: "Date",
  };

  function updateSection(id: string, value: any) {
    setContent((prev: any) => ({ ...prev, [id]: value }));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const resume = await api.putSections(resumeId, content);
      onSaved(resume);
    } catch (err: any) {
      const detail = err?.detail ?? err;
      if (detail?.error === "not_one_page") {
        const pc = detail.page_count ?? "?";
        setError(`Renders to ${pc} pages — tighten and try again.`);
      } else if (typeof detail === "string") {
        setError(detail);
      } else if (detail?.message) {
        setError(detail.message);
      } else {
        setError("Save failed.");
      }
    } finally {
      setSaving(false);
    }
  }

  function renderHeader(id: string) {
    const data = content[id] || { name: "", tagline: "", contacts: [] };
    const contacts: Contact[] = data.contacts || [];
    return (
      <section key={id} style={sectionStyle}>
        <h2 style={sectionHeading}>Header</h2>
        <div style={fieldGrid}>
          <Field label="Name">
            <Input
              value={data.name || ""}
              onChange={(e) => updateSection(id, { ...data, name: e.target.value })}
            />
          </Field>
          <Field label="Tagline">
            <Input
              value={data.tagline || ""}
              onChange={(e) =>
                updateSection(id, { ...data, tagline: e.target.value })
              }
            />
          </Field>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="eyebrow">Contacts</div>
          {contacts.map((c, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr 1fr auto",
                gap: 8,
                alignItems: "center",
              }}
            >
              <Input
                aria-label={`Contact ${i} label`}
                placeholder="label"
                value={c.label}
                onChange={(e) => {
                  const next = [...contacts];
                  next[i] = { ...c, label: e.target.value };
                  updateSection(id, { ...data, contacts: next });
                }}
              />
              <Input
                aria-label={`Contact ${i} value`}
                placeholder="value"
                value={c.value}
                onChange={(e) => {
                  const next = [...contacts];
                  next[i] = { ...c, value: e.target.value };
                  updateSection(id, { ...data, contacts: next });
                }}
              />
              <Input
                aria-label={`Contact ${i} url`}
                placeholder="url (optional)"
                value={c.url}
                onChange={(e) => {
                  const next = [...contacts];
                  next[i] = { ...c, url: e.target.value };
                  updateSection(id, { ...data, contacts: next });
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remove row"
                onClick={() => {
                  const next = contacts.filter((_, j) => j !== i);
                  updateSection(id, { ...data, contacts: next });
                }}
                icon={<Glyph name="x" size={12} />}
              >
                {""}
              </Button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Add contact row"
              icon={<Glyph name="plus" size={12} />}
              onClick={() =>
                updateSection(id, {
                  ...data,
                  contacts: [...contacts, { label: "", value: "", url: "" }],
                })
              }
            >
              Add contact
            </Button>
          </div>
        </div>
      </section>
    );
  }

  function renderSubheadingRow(
    sectionId: string,
    rows: SubheadingRow[],
    row: SubheadingRow,
    i: number,
  ) {
    return (
      <div key={i} style={rowCard}>
        <div style={fieldGrid}>
          {(["institution", "location", "degree", "date"] as const).map((k) => (
            <Field key={k} label={subheadingFields[k] || k}>
              <Input
                data-testid={`${sectionId}-row-${i}-${k}`}
                value={(row as any)[k] || ""}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, [k]: e.target.value };
                  updateSection(sectionId, next);
                }}
              />
            </Field>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="eyebrow">Bullets</div>
          {(row.bullets || []).map((b, j) => (
            <div
              key={j}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 6,
                alignItems: "start",
              }}
            >
              <Textarea
                aria-label={`${sectionId} row ${i} bullet ${j}`}
                value={b}
                rows={2}
                style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}
                onChange={(e) => {
                  const next = [...rows];
                  const bullets = [...(row.bullets || [])];
                  bullets[j] = e.target.value;
                  next[i] = { ...row, bullets };
                  updateSection(sectionId, next);
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remove row"
                icon={<Glyph name="x" size={12} />}
                onClick={() => {
                  const next = [...rows];
                  const bullets = (row.bullets || []).filter((_, k) => k !== j);
                  next[i] = { ...row, bullets };
                  updateSection(sectionId, next);
                }}
              >
                {""}
              </Button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="ghost"
              icon={<Glyph name="plus" size={12} />}
              onClick={() => {
                const next = [...rows];
                const bullets = [...(row.bullets || []), ""];
                next[i] = { ...row, bullets };
                updateSection(sectionId, next);
              }}
            >
              Add bullet
            </Button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Remove row"
            icon={<Glyph name="x" size={12} />}
            onClick={() => {
              const next = rows.filter((_, k) => k !== i);
              updateSection(sectionId, next);
            }}
          >
            Remove entry
          </Button>
        </div>
      </div>
    );
  }

  function renderListSubheading(id: string, title: string) {
    const rows: SubheadingRow[] = content[id] || [];
    return (
      <section key={id} style={sectionStyle}>
        <h2 style={sectionHeading}>{title}</h2>
        {rows.map((row, i) => renderSubheadingRow(id, rows, row, i))}
        <div>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Add ${id} row`}
            icon={<Glyph name="plus" size={12} />}
            onClick={() =>
              updateSection(id, [
                ...rows,
                {
                  institution: "",
                  location: "",
                  degree: "",
                  date: "",
                  bullets: [],
                },
              ])
            }
          >
            Add entry
          </Button>
        </div>
      </section>
    );
  }

  function renderProjectRow(
    sectionId: string,
    rows: ProjectRow[],
    row: ProjectRow,
    i: number,
  ) {
    return (
      <div key={i} style={rowCard}>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr 160px", gap: 10 }}
        >
          {(["name", "tech", "date"] as const).map((k) => (
            <Field key={k} label={projectFields[k] || k}>
              <Input
                data-testid={`${sectionId}-row-${i}-${k}`}
                value={(row as any)[k] || ""}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, [k]: e.target.value };
                  updateSection(sectionId, next);
                }}
              />
            </Field>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="eyebrow">Bullets</div>
          {(row.bullets || []).map((b, j) => (
            <div
              key={j}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 6,
                alignItems: "start",
              }}
            >
              <Textarea
                aria-label={`${sectionId} row ${i} bullet ${j}`}
                value={b}
                rows={2}
                style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}
                onChange={(e) => {
                  const next = [...rows];
                  const bullets = [...(row.bullets || [])];
                  bullets[j] = e.target.value;
                  next[i] = { ...row, bullets };
                  updateSection(sectionId, next);
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remove row"
                icon={<Glyph name="x" size={12} />}
                onClick={() => {
                  const next = [...rows];
                  const bullets = (row.bullets || []).filter((_, k) => k !== j);
                  next[i] = { ...row, bullets };
                  updateSection(sectionId, next);
                }}
              >
                {""}
              </Button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="ghost"
              icon={<Glyph name="plus" size={12} />}
              onClick={() => {
                const next = [...rows];
                const bullets = [...(row.bullets || []), ""];
                next[i] = { ...row, bullets };
                updateSection(sectionId, next);
              }}
            >
              Add bullet
            </Button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Remove row"
            icon={<Glyph name="x" size={12} />}
            onClick={() => {
              const next = rows.filter((_, k) => k !== i);
              updateSection(sectionId, next);
            }}
          >
            Remove project
          </Button>
        </div>
      </div>
    );
  }

  function renderListProject(id: string, title: string) {
    const rows: ProjectRow[] = content[id] || [];
    return (
      <section key={id} style={sectionStyle}>
        <h2 style={sectionHeading}>{title}</h2>
        {rows.map((row, i) => renderProjectRow(id, rows, row, i))}
        <div>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Add ${id} row`}
            icon={<Glyph name="plus" size={12} />}
            onClick={() =>
              updateSection(id, [
                ...rows,
                { name: "", tech: "", date: "", bullets: [] },
              ])
            }
          >
            Add project
          </Button>
        </div>
      </section>
    );
  }

  function renderKeyValueList(id: string, title: string) {
    const data: Record<string, string> = content[id] || {};
    const entries = Object.entries(data);
    return (
      <section key={id} style={sectionStyle}>
        <h2 style={sectionHeading}>{title}</h2>
        {entries.map(([group, csv], i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "180px 1fr auto",
              gap: 8,
              alignItems: "center",
            }}
          >
            <Input
              aria-label={`${id} group ${i}`}
              value={group}
              placeholder="Group (e.g. Languages)"
              onChange={(e) => {
                const newKey = e.target.value;
                const next: Record<string, string> = {};
                entries.forEach(([k, v], j) => {
                  next[j === i ? newKey : k] = v;
                });
                updateSection(id, next);
              }}
            />
            <Input
              aria-label={`${id} value ${i}`}
              value={csv}
              placeholder="comma-separated values"
              onChange={(e) => {
                const next = { ...data, [group]: e.target.value };
                updateSection(id, next);
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label="Remove row"
              icon={<Glyph name="x" size={12} />}
              onClick={() => {
                const next: Record<string, string> = {};
                entries.forEach(([k, v], j) => {
                  if (j !== i) next[k] = v;
                });
                updateSection(id, next);
              }}
            >
              {""}
            </Button>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Add ${id} row`}
            icon={<Glyph name="plus" size={12} />}
            onClick={() => {
              const next = { ...data, "": "" };
              updateSection(id, next);
            }}
          >
            Add group
          </Button>
        </div>
      </section>
    );
  }

  const sections = schema.sections || [];

  return (
    <div
      className="section-form-editor"
      style={{
        background: "var(--paper-2)",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ flex: 1, overflow: "auto" }}>
        {sections.map((s: any) => {
          if (s.type === "header") return renderHeader(s.id);
          if (s.type === "list_subheading")
            return renderListSubheading(s.id, s.title || s.id);
          if (s.type === "list_project")
            return renderListProject(s.id, s.title || s.id);
          if (s.type === "key_value_list")
            return renderKeyValueList(s.id, s.title || s.id);
          return null;
        })}
      </div>
      <div
        style={{
          padding: "10px 14px",
          borderTop: "1px solid var(--rule)",
          background: "var(--paper)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        {error && (
          <div role="alert" className="mono" style={{ color: "var(--err)", fontSize: 12 }}>
            {error}
          </div>
        )}
        <span style={{ flex: 1 }} />
        <Button onClick={handleSave} disabled={saving} variant="primary">
          {saving ? "Saving…" : "Save & compile"}
        </Button>
      </div>
    </div>
  );
}
