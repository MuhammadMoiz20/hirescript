import { useEffect, useRef, useState } from "react";
import { api, Job, JobDescriptionOut, ResumeGroup, Variant } from "../api";
import TailorModal from "../components/TailorModal";
import MassApplyDialog from "../components/MassApplyDialog";
import TopChrome from "../components/ui/TopChrome";
import Button from "../components/ui/Button";
import KebabMenu from "../components/ui/KebabMenu";
import Onboarding from "./Onboarding";

type View = "library" | "onboarding";

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Meta({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 11,
        color: "var(--ink-3)",
        padding: "2px 8px",
        border: "1px solid var(--rule)",
        borderRadius: 2,
        background: "var(--paper-2)",
      }}
    >
      {children}
    </span>
  );
}

interface RenameTitleProps {
  name: string;
  fontSize: number;
  serif: boolean;
  editing: boolean;
  onSave: (next: string) => Promise<void>;
  onCancel: () => void;
}

function RenameTitle({ name, fontSize, serif, editing, onSave, onCancel }: RenameTitleProps) {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) {
      setValue(name);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, name]);

  if (!editing) {
    return (
      <span
        style={{
          fontFamily: serif ? "var(--f-serif)" : undefined,
          fontSize,
          letterSpacing: serif ? "-0.01em" : undefined,
          fontWeight: serif ? 400 : 500,
        }}
      >
        {name}
      </span>
    );
  }

  async function commit() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      onCancel();
      return;
    }
    setBusy(true);
    try {
      await onSave(trimmed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <input
      ref={inputRef}
      value={value}
      disabled={busy}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      style={{
        fontFamily: serif ? "var(--f-serif)" : undefined,
        fontSize,
        letterSpacing: serif ? "-0.01em" : undefined,
        fontWeight: serif ? 400 : 500,
        padding: "2px 6px",
        border: "1px solid var(--rule-strong)",
        borderRadius: 3,
        background: "var(--paper)",
        color: "var(--ink)",
        outline: "none",
        minWidth: 200,
      }}
    />
  );
}

interface DialogProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer: React.ReactNode;
}

function Dialog({ title, children, onClose, footer }: DialogProps) {
  return (
    <div
      role="dialog"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in oklch, var(--ink) 35%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--paper)",
          color: "var(--ink)",
          border: "1px solid var(--rule-strong)",
          borderRadius: 4,
          padding: "20px 22px",
          width: "min(520px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h2 style={{ fontFamily: "var(--f-serif)", fontSize: 20, margin: 0, letterSpacing: "-0.01em" }}>
          {title}
        </h2>
        <div>{children}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>{footer}</div>
      </div>
    </div>
  );
}

type DeleteTarget =
  | { kind: "simple"; id: number; name: string; isMaster: boolean }
  | { kind: "promote"; masterId: number; name: string; variants: Variant[] };

interface VariantRowProps {
  variant: Variant;
  onOpen: (id: number) => void;
  editingId: number | null;
  setEditingId: (id: number | null) => void;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (variant: Variant) => void;
  onDownload: (id: number, name: string) => void;
  onViewJd: (variant: Variant) => void;
}

function VariantRow({
  variant, onOpen, editingId, setEditingId, onRename, onDelete, onDownload, onViewJd,
}: VariantRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 0",
        borderTop: "1px solid var(--rule)",
        fontSize: 13,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--rule-strong)",
          flexShrink: 0,
        }}
      />
      <RenameTitle
        name={variant.name}
        fontSize={13}
        serif={false}
        editing={editingId === variant.id}
        onSave={async (next) => {
          await onRename(variant.id, next);
          setEditingId(null);
        }}
        onCancel={() => setEditingId(null)}
      />
      {variant.jd_company && (
        <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
          {variant.jd_title} @ {variant.jd_company}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <Button size="sm" variant="ghost" onClick={() => onOpen(variant.id)}>
        Open
      </Button>
      <KebabMenu
        items={[
          { label: "Rename", icon: "edit", onClick: () => setEditingId(variant.id) },
          { label: "Download PDF", icon: "download", onClick: () => onDownload(variant.id, variant.name) },
          {
            label: "View JD",
            icon: "doc",
            onClick: () => onViewJd(variant),
            disabled: variant.job_description_id == null,
          },
          { label: "Delete", icon: "x", danger: true, onClick: () => onDelete(variant) },
        ]}
      />
    </div>
  );
}

interface MasterCardProps {
  group: ResumeGroup;
  onOpen: (id: number) => void;
  onTailor: (id: number, name: string) => void;
  onMassApply: (id: number, name: string) => void;
  editingId: number | null;
  setEditingId: (id: number | null) => void;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (target: DeleteTarget) => void;
  onDuplicate: (id: number) => Promise<void>;
  onDownload: (id: number, name: string) => void;
  onViewJd: (variant: Variant) => void;
}

function MasterCard({
  group, onOpen, onTailor, onMassApply, editingId, setEditingId, onRename, onDelete, onDuplicate, onDownload, onViewJd,
}: MasterCardProps) {
  const { master, variants } = group;
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        background: "var(--paper)",
        borderRadius: 4,
        padding: 16,
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <RenameTitle
            name={master.name}
            fontSize={18}
            serif={true}
            editing={editingId === master.id}
            onSave={async (next) => {
              await onRename(master.id, next);
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
          />
          <Meta>master</Meta>
          <Meta>edited {fmtDate(master.updated_at)}</Meta>
          <Meta>
            {variants.length} variant{variants.length === 1 ? "" : "s"}
          </Meta>
        </div>
        <KebabMenu
          items={[
            { label: "Rename", icon: "edit", onClick: () => setEditingId(master.id) },
            { label: "Mass apply", icon: "sparkle", onClick: () => onMassApply(master.id, master.name) },
            { label: "Download PDF", icon: "download", onClick: () => onDownload(master.id, master.name) },
            { label: "Duplicate", icon: "docs", onClick: () => onDuplicate(master.id) },
            {
              label: "Delete",
              icon: "x",
              danger: true,
              onClick: () => {
                if (variants.length === 0) {
                  onDelete({ kind: "simple", id: master.id, name: master.name, isMaster: true });
                } else {
                  onDelete({ kind: "promote", masterId: master.id, name: master.name, variants });
                }
              },
            },
          ]}
        />
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" icon="doc" onClick={() => onOpen(master.id)}>
          Open editor
        </Button>
        <Button icon="sparkle" onClick={() => onTailor(master.id, master.name)}>
          Tailor to JD
        </Button>
      </div>

      {variants.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {variants.map((v) => (
            <VariantRow
              key={v.id}
              variant={v}
              onOpen={onOpen}
              editingId={editingId}
              setEditingId={setEditingId}
              onRename={onRename}
              onDelete={(variant) =>
                onDelete({ kind: "simple", id: variant.id, name: variant.name, isMaster: false })
              }
              onDownload={onDownload}
              onViewJd={onViewJd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ResumeList({ onOpen }: { onOpen: (id: number) => void }) {
  const [groups, setGroups] = useState<ResumeGroup[]>([]);
  const [tailorTarget, setTailorTarget] = useState<{ id: number; name: string } | null>(null);
  const [massApplyTarget, setMassApplyTarget] = useState<{ id: number; name: string } | null>(null);
  const [view, setView] = useState<View>("library");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [promoteChoice, setPromoteChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [jdView, setJdView] = useState<{ variant: Variant; jd: JobDescriptionOut | null } | null>(null);

  async function refresh() {
    setGroups(await api.listGroupedResumes());
  }
  useEffect(() => {
    refresh();
  }, []);

  function onTailorCreated(_job: Job) {
    setTailorTarget(null);
    refresh();
  }

  async function handleRename(id: number, name: string) {
    try {
      await api.renameResume(id, name);
      await refresh();
    } catch (e: any) {
      setErrMsg(e?.message || "Rename failed");
    }
  }

  async function handleDuplicate(id: number) {
    try {
      await api.duplicateResume(id);
      await refresh();
    } catch (e: any) {
      setErrMsg(e?.message || "Duplicate failed");
    }
  }

  async function handleDownload(id: number, name: string) {
    try {
      await api.downloadResumePdf(id, name);
    } catch (e: any) {
      setErrMsg(e?.error === "compile_failed" ? "Compile failed — open the editor to fix LaTeX." : (e?.message || "Download failed"));
    }
  }

  async function handleViewJd(variant: Variant) {
    if (variant.job_description_id == null) return;
    setJdView({ variant, jd: null });
    try {
      const jd = await api.getJd(variant.job_description_id);
      setJdView({ variant, jd });
    } catch {
      setJdView(null);
      setErrMsg("Could not load JD");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      if (deleteTarget.kind === "simple") {
        await api.deleteResume(deleteTarget.id);
      } else {
        if (promoteChoice == null) return;
        await api.deleteResume(deleteTarget.masterId, promoteChoice);
      }
      setDeleteTarget(null);
      setPromoteChoice(null);
      await refresh();
    } catch (e: any) {
      setErrMsg(e?.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  if (view === "onboarding") {
    return (
      <Onboarding
        onCancel={() => setView("library")}
        onCreated={async (resume) => {
          await refresh();
          setView("library");
          if (resume && typeof (resume as any).id === "number") {
            onOpen((resume as any).id);
          }
        }}
      />
    );
  }

  const empty = groups.length === 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome>Library</TopChrome>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "clamp(16px, 3vw, 24px)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Your resumes</div>
              <h1
                style={{
                  fontFamily: "var(--f-serif)",
                  fontSize: 26,
                  letterSpacing: "-0.02em",
                  margin: 0,
                }}
              >
                Resumes
              </h1>
            </div>
            {!empty && (
              <Button variant="primary" icon="plus" onClick={() => setView("onboarding")}>
                New resume
              </Button>
            )}
          </div>

          {errMsg && (
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
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span>{errMsg}</span>
              <button
                onClick={() => setErrMsg(null)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-2)" }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {empty ? (
            <div
              style={{
                border: "1px dashed var(--rule-strong)",
                borderRadius: 4,
                padding: "48px 24px",
                textAlign: "center",
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--f-serif)",
                  fontSize: 22,
                  letterSpacing: "-0.01em",
                  margin: "0 0 6px",
                }}
              >
                No resumes yet
              </h2>
              <p style={{ color: "var(--ink-2)", fontSize: 13, margin: "0 0 18px" }}>
                Start one from scratch, paste LaTeX, or upload a PDF.
              </p>
              <Button variant="primary" icon="plus" onClick={() => setView("onboarding")}>
                New resume
              </Button>
            </div>
          ) : (
            groups.map((g) => (
              <MasterCard
                key={g.master.id}
                group={g}
                onOpen={onOpen}
                onTailor={(id, name) => setTailorTarget({ id, name })}
                onMassApply={(id, name) => setMassApplyTarget({ id, name })}
                editingId={editingId}
                setEditingId={setEditingId}
                onRename={handleRename}
                onDelete={(t) => {
                  setDeleteTarget(t);
                  setPromoteChoice(t.kind === "promote" ? t.variants[0]?.id ?? null : null);
                }}
                onDuplicate={handleDuplicate}
                onDownload={handleDownload}
                onViewJd={handleViewJd}
              />
            ))
          )}
        </div>
      </div>

      {tailorTarget && (
        <TailorModal
          masterId={tailorTarget.id}
          masterName={tailorTarget.name}
          open={true}
          onClose={() => setTailorTarget(null)}
          onCreated={onTailorCreated}
        />
      )}

      {massApplyTarget && (
        <MassApplyDialog
          open={true}
          masterId={massApplyTarget.id}
          masterName={massApplyTarget.name}
          onClose={() => setMassApplyTarget(null)}
        />
      )}

      {deleteTarget && deleteTarget.kind === "simple" && (
        <Dialog
          title={deleteTarget.isMaster ? "Delete resume?" : "Delete variant?"}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete} disabled={busy}>
                {busy ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
            <strong style={{ color: "var(--ink)" }}>{deleteTarget.name}</strong> will be permanently
            removed, along with its version history. This cannot be undone.
          </p>
        </Dialog>
      )}

      {deleteTarget && deleteTarget.kind === "promote" && (
        <Dialog
          title="Pick a new master"
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmDelete}
                disabled={busy || promoteChoice == null}
              >
                {busy ? "Deleting…" : "Promote & delete"}
              </Button>
            </>
          }
        >
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-2)" }}>
            <strong style={{ color: "var(--ink)" }}>{deleteTarget.name}</strong> has{" "}
            {deleteTarget.variants.length} variant
            {deleteTarget.variants.length === 1 ? "" : "s"}. Choose one to promote to master; the rest
            will be re-parented to it.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {deleteTarget.variants.map((v) => (
              <label
                key={v.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  border: "1px solid var(--rule)",
                  borderRadius: 3,
                  cursor: "pointer",
                  background: promoteChoice === v.id ? "var(--paper-2)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="promote"
                  checked={promoteChoice === v.id}
                  onChange={() => setPromoteChoice(v.id)}
                />
                <span style={{ fontSize: 13, fontWeight: 500 }}>{v.name}</span>
                {v.jd_company && (
                  <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
                    {v.jd_title} @ {v.jd_company}
                  </span>
                )}
              </label>
            ))}
          </div>
        </Dialog>
      )}

      {jdView && (
        <Dialog
          title="Job description"
          onClose={() => setJdView(null)}
          footer={
            <Button onClick={() => setJdView(null)}>Close</Button>
          }
        >
          {!jdView.jd ? (
            <p style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading…</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{jdView.jd.title}</div>
                <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{jdView.jd.company}</div>
              </div>
              {jdView.jd.url && (
                <a
                  href={jdView.jd.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: "var(--ink-2)", wordBreak: "break-all" }}
                >
                  {jdView.jd.url}
                </a>
              )}
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--f-mono)",
                  fontSize: 12,
                  background: "var(--paper-2)",
                  border: "1px solid var(--rule)",
                  borderRadius: 3,
                  padding: 10,
                  margin: 0,
                  maxHeight: 320,
                  overflow: "auto",
                }}
              >
                {jdView.jd.raw_text}
              </pre>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
