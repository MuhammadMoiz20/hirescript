import { useEffect, useState } from "react";
import TopChrome from "../components/ui/TopChrome";
import ProfileTab from "../components/knowledge/ProfileTab";
import DocumentsTab from "../components/knowledge/DocumentsTab";
import SourcesTab from "../components/knowledge/SourcesTab";

export type KnowledgeTab = "profile" | "documents" | "sources";

const TAB_IDS: KnowledgeTab[] = ["profile", "documents", "sources"];

interface Props {
  onBack?: () => void;
  tab?: KnowledgeTab;
  onTabChange?: (tab: KnowledgeTab) => void;
}

function readTabFromLocation(): KnowledgeTab | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t && (TAB_IDS as string[]).includes(t)) return t as KnowledgeTab;
  } catch {
    // ignore parsing errors
  }
  return null;
}

function writeTabToLocation(tab: KnowledgeTab) {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url);
  } catch {
    // non-fatal
  }
}

export default function Knowledge({ onBack, tab: controlledTab, onTabChange }: Props) {
  const [internalTab, setInternalTab] = useState<KnowledgeTab>(() => {
    if (controlledTab) return controlledTab;
    return readTabFromLocation() ?? "profile";
  });

  const tab = controlledTab ?? internalTab;

  useEffect(() => {
    writeTabToLocation(tab);
  }, [tab]);

  function selectTab(next: KnowledgeTab) {
    if (next === tab) return;
    setInternalTab(next);
    onTabChange?.(next);
    writeTabToLocation(next);
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome onLogoClick={onBack}>Knowledge</TopChrome>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(16px, 3vw, 24px) clamp(16px, 3vw, 24px) 0" }}>
          <div style={{ marginBottom: 4 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Knowledge</div>
            <h1
              style={{
                fontFamily: "var(--f-serif)",
                fontSize: 26,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              The agent's source of truth
            </h1>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 13,
                color: "var(--ink-3)",
                maxWidth: 760,
                lineHeight: 1.5,
              }}
            >
              Profile facts, retrievable documents, and the connectors that feed them.
              Everything the agent says about you must come from here.
            </p>
          </div>
        </div>
        <div
          role="tablist"
          aria-label="Knowledge sections"
          style={{
            display: "flex",
            gap: 0,
            borderBottom: "1px solid var(--rule)",
            padding: "0 clamp(16px, 3vw, 24px)",
            margin: "16px auto 0",
            maxWidth: 1100,
          }}
        >
          {TAB_IDS.map((id) => {
            const active = tab === id;
            const label = id === "profile" ? "Profile" : id === "documents" ? "Documents" : "Sources";
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                aria-controls={`knowledge-panel-${id}`}
                id={`knowledge-tab-${id}`}
                data-testid={`knowledge-tab-${id}`}
                onClick={() => selectTab(id)}
                style={{
                  appearance: "none",
                  background: "transparent",
                  border: "none",
                  borderBottom: active ? "2px solid var(--ink)" : "2px solid transparent",
                  padding: "10px 14px",
                  marginBottom: -1,
                  fontFamily: "var(--f-sans)",
                  fontSize: 13,
                  color: active ? "var(--ink)" : "var(--ink-3)",
                  cursor: "pointer",
                  fontWeight: active ? 500 : 400,
                  letterSpacing: "0.01em",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div
          role="tabpanel"
          id={`knowledge-panel-${tab}`}
          aria-labelledby={`knowledge-tab-${tab}`}
        >
          {tab === "profile" && <ProfileTab />}
          {tab === "documents" && <DocumentsTab />}
          {tab === "sources" && <SourcesTab />}
        </div>
      </div>
    </div>
  );
}
