import { useEffect, useState } from "react";
import { api, ResumeGroup, TailorResponse, Variant } from "../api";
import TailorModal from "../components/TailorModal";
import TopChrome from "../components/ui/TopChrome";
import Button from "../components/ui/Button";
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

interface VariantRowProps {
  variant: Variant;
  onOpen: (id: number) => void;
}

function VariantRow({ variant, onOpen }: VariantRowProps) {
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
      <span style={{ fontWeight: 500 }}>{variant.name}</span>
      {variant.jd_company && (
        <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
          {variant.jd_title} @ {variant.jd_company}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <Button size="sm" variant="ghost" onClick={() => onOpen(variant.id)}>
        Open
      </Button>
    </div>
  );
}

interface MasterCardProps {
  group: ResumeGroup;
  onOpen: (id: number) => void;
  onTailor: (id: number, name: string) => void;
}

function MasterCard({ group, onOpen, onTailor }: MasterCardProps) {
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
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2
          style={{
            fontFamily: "var(--f-serif)",
            fontSize: 18,
            letterSpacing: "-0.01em",
            margin: 0,
          }}
        >
          {master.name}
        </h2>
        <Meta>master</Meta>
        <Meta>edited {fmtDate(master.updated_at)}</Meta>
        <Meta>
          {variants.length} variant{variants.length === 1 ? "" : "s"}
        </Meta>
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
            <VariantRow key={v.id} variant={v} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ResumeList({ onOpen }: { onOpen: (id: number) => void }) {
  const [groups, setGroups] = useState<ResumeGroup[]>([]);
  const [tailorTarget, setTailorTarget] = useState<{ id: number; name: string } | null>(null);
  const [view, setView] = useState<View>("library");

  async function refresh() {
    setGroups(await api.listGroupedResumes());
  }
  useEffect(() => {
    refresh();
  }, []);

  function onTailorCreated(_resp: TailorResponse) {
    setTailorTarget(null);
    refresh();
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
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
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
    </div>
  );
}
