import { useState } from "react";
import { api, ResumeOut, SectionsPayload } from "../api";

interface Props {
  resumeId: number;
  payload: SectionsPayload;
  onSaved: (resume: ResumeOut) => void;
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

export default function SectionFormEditor({ resumeId, payload, onSaved }: Props) {
  const [content, setContent] = useState<any>(() =>
    JSON.parse(JSON.stringify(payload.content_json)),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      <section key={id}>
        <h2>Header</h2>
        <label>
          Name
          <input
            value={data.name || ""}
            onChange={(e) =>
              updateSection(id, { ...data, name: e.target.value })
            }
          />
        </label>
        <label>
          Tagline
          <input
            value={data.tagline || ""}
            onChange={(e) =>
              updateSection(id, { ...data, tagline: e.target.value })
            }
          />
        </label>
        <div>
          <h3>Contacts</h3>
          {contacts.map((c, i) => (
            <div key={i}>
              <input
                aria-label={`Contact ${i} label`}
                placeholder="label"
                value={c.label}
                onChange={(e) => {
                  const next = [...contacts];
                  next[i] = { ...c, label: e.target.value };
                  updateSection(id, { ...data, contacts: next });
                }}
              />
              <input
                aria-label={`Contact ${i} value`}
                placeholder="value"
                value={c.value}
                onChange={(e) => {
                  const next = [...contacts];
                  next[i] = { ...c, value: e.target.value };
                  updateSection(id, { ...data, contacts: next });
                }}
              />
              <input
                aria-label={`Contact ${i} url`}
                placeholder="url"
                value={c.url}
                onChange={(e) => {
                  const next = [...contacts];
                  next[i] = { ...c, url: e.target.value };
                  updateSection(id, { ...data, contacts: next });
                }}
              />
              <button
                type="button"
                aria-label="Remove row"
                onClick={() => {
                  const next = contacts.filter((_, j) => j !== i);
                  updateSection(id, { ...data, contacts: next });
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            aria-label="Add contact row"
            onClick={() =>
              updateSection(id, {
                ...data,
                contacts: [...contacts, { label: "", value: "", url: "" }],
              })
            }
          >
            Add contact
          </button>
        </div>
      </section>
    );
  }

  function renderListSubheading(id: string, title: string) {
    const rows: SubheadingRow[] = content[id] || [];
    return (
      <section key={id}>
        <h2>{title}</h2>
        {rows.map((row, i) => (
          <div key={i}>
            {(["institution", "location", "degree", "date"] as const).map((k) => (
              <div key={k}>
                <span>{subheadingFields[k] || k}</span>
                <input
                  data-testid={`${id}-row-${i}-${k}`}
                  value={(row as any)[k] || ""}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...row, [k]: e.target.value };
                    updateSection(id, next);
                  }}
                />
              </div>
            ))}
            <div>
              <strong>Bullets</strong>
              {(row.bullets || []).map((b, j) => (
                <div key={j}>
                  <textarea
                    aria-label={`${id} row ${i} bullet ${j}`}
                    value={b}
                    onChange={(e) => {
                      const next = [...rows];
                      const bullets = [...(row.bullets || [])];
                      bullets[j] = e.target.value;
                      next[i] = { ...row, bullets };
                      updateSection(id, next);
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Remove row"
                    onClick={() => {
                      const next = [...rows];
                      const bullets = (row.bullets || []).filter(
                        (_, k) => k !== j,
                      );
                      next[i] = { ...row, bullets };
                      updateSection(id, next);
                    }}
                  >
                    Remove bullet
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const next = [...rows];
                  const bullets = [...(row.bullets || []), ""];
                  next[i] = { ...row, bullets };
                  updateSection(id, next);
                }}
              >
                Add bullet
              </button>
            </div>
            <button
              type="button"
              aria-label="Remove row"
              onClick={() => {
                const next = rows.filter((_, k) => k !== i);
                updateSection(id, next);
              }}
            >
              Remove row
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label={`Add ${id} row`}
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
          Add row
        </button>
      </section>
    );
  }

  function renderListProject(id: string, title: string) {
    const rows: ProjectRow[] = content[id] || [];
    return (
      <section key={id}>
        <h2>{title}</h2>
        {rows.map((row, i) => (
          <div key={i}>
            {(["name", "tech", "date"] as const).map((k) => (
              <div key={k}>
                <span>{projectFields[k] || k}</span>
                <input
                  data-testid={`${id}-row-${i}-${k}`}
                  value={(row as any)[k] || ""}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...row, [k]: e.target.value };
                    updateSection(id, next);
                  }}
                />
              </div>
            ))}
            <div>
              <strong>Bullets</strong>
              {(row.bullets || []).map((b, j) => (
                <div key={j}>
                  <textarea
                    aria-label={`${id} row ${i} bullet ${j}`}
                    value={b}
                    onChange={(e) => {
                      const next = [...rows];
                      const bullets = [...(row.bullets || [])];
                      bullets[j] = e.target.value;
                      next[i] = { ...row, bullets };
                      updateSection(id, next);
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Remove row"
                    onClick={() => {
                      const next = [...rows];
                      const bullets = (row.bullets || []).filter(
                        (_, k) => k !== j,
                      );
                      next[i] = { ...row, bullets };
                      updateSection(id, next);
                    }}
                  >
                    Remove bullet
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const next = [...rows];
                  const bullets = [...(row.bullets || []), ""];
                  next[i] = { ...row, bullets };
                  updateSection(id, next);
                }}
              >
                Add bullet
              </button>
            </div>
            <button
              type="button"
              aria-label="Remove row"
              onClick={() => {
                const next = rows.filter((_, k) => k !== i);
                updateSection(id, next);
              }}
            >
              Remove row
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label={`Add ${id} row`}
          onClick={() =>
            updateSection(id, [
              ...rows,
              { name: "", tech: "", date: "", bullets: [] },
            ])
          }
        >
          Add row
        </button>
      </section>
    );
  }

  function renderKeyValueList(id: string, title: string) {
    const data: Record<string, string> = content[id] || {};
    const entries = Object.entries(data);
    return (
      <section key={id}>
        <h2>{title}</h2>
        {entries.map(([group, csv], i) => (
          <div key={i}>
            <input
              aria-label={`${id} group ${i}`}
              value={group}
              onChange={(e) => {
                const newKey = e.target.value;
                const next: Record<string, string> = {};
                entries.forEach(([k, v], j) => {
                  next[j === i ? newKey : k] = v;
                });
                updateSection(id, next);
              }}
            />
            <input
              aria-label={`${id} value ${i}`}
              value={csv}
              onChange={(e) => {
                const next = { ...data, [group]: e.target.value };
                updateSection(id, next);
              }}
            />
            <button
              type="button"
              aria-label="Remove row"
              onClick={() => {
                const next: Record<string, string> = {};
                entries.forEach(([k, v], j) => {
                  if (j !== i) next[k] = v;
                });
                updateSection(id, next);
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label={`Add ${id} row`}
          onClick={() => {
            const next = { ...data, "": "" };
            updateSection(id, next);
          }}
        >
          Add group
        </button>
      </section>
    );
  }

  const sections = schema.sections || [];

  return (
    <div className="section-form-editor">
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
      {error && <div role="alert">{error}</div>}
      <button type="button" onClick={handleSave} disabled={saving}>
        Save
      </button>
    </div>
  );
}
