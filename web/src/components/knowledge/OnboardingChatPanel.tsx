import { useEffect, useRef, useState } from "react";
import { api, OnboardingTurn } from "../../api";
import Button from "../ui/Button";

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  initialHistory?: OnboardingTurn[];
  className?: string;
}

/**
 * OnboardingChatPanel — docked side-panel inside Knowledge → Profile tab.
 *
 * Was a top-level route (`/onboarding`) prior to T15. The bundle treats
 * onboarding as a Profile-adjacent activity ("Onboarding gaps" section in
 * KnowledgeProfile), not a standalone destination, so the chat now lives
 * inline as a collapsible right-hand rail next to the profile editor.
 *
 * The chat behavior (streaming, tool events, profile refresh on completion)
 * is preserved verbatim from the old `OnboardingChat` route.
 */
export default function OnboardingChatPanel({
  collapsed,
  onToggleCollapsed,
  initialHistory = [],
  className,
}: Props) {
  const [history, setHistory] = useState<OnboardingTurn[]>(initialHistory);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolEvents, setToolEvents] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, toolEvents]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const message = input.trim();
    if (!message || streaming) return;
    setError(null);
    setInput("");
    const priorHistory = history;
    const turnHistory: OnboardingTurn[] = [
      ...priorHistory,
      { role: "user", content: message },
      { role: "assistant", content: "" },
    ];
    setHistory(turnHistory);
    setStreaming(true);

    let assistantSoFar = "";
    try {
      await api.streamOnboarding(
        message,
        priorHistory,
        {
          onChunk: (text) => {
            assistantSoFar += text;
            setHistory((h) => {
              const next = [...h];
              const lastIdx = next.length - 1;
              if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                next[lastIdx] = { role: "assistant", content: assistantSoFar };
              }
              return next;
            });
          },
          onTool: (event) => {
            if (event.type === "tool_use") {
              setToolEvents((t) => [...t, `call ${event.tool}(...)`]);
            } else if (event.type === "tool_result") {
              setToolEvents((t) => [...t, `ok ${event.tool}`]);
            } else if (event.type === "tool_error") {
              setToolEvents((t) => [...t, `err ${event.tool}: ${event.error}`]);
            }
          },
          onError: (msg) => setError(msg),
        },
      );
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setStreaming(false);
      // Refresh profile so any agent writes are reflected when the user
      // navigates to the Profile editor next.
      try {
        await api.getProfile();
      } catch {
        // non-fatal — profile refresh is a background convenience.
      }
    }
  }

  if (collapsed) {
    return (
      <aside
        data-component="onboarding-chat-panel"
        data-collapsed="true"
        aria-label="Onboarding chat (collapsed)"
        className={className}
        style={{
          width: 36,
          flexShrink: 0,
          borderLeft: "1px solid var(--rule)",
          background: "var(--paper-2)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "10px 0",
        }}
      >
        <button
          type="button"
          aria-label="Open onboarding chat"
          aria-expanded={false}
          onClick={onToggleCollapsed}
          style={{
            appearance: "none",
            background: "transparent",
            border: "1px solid var(--rule)",
            borderRadius: 3,
            color: "var(--ink-2)",
            cursor: "pointer",
            padding: "6px 4px",
            fontSize: 11,
            fontFamily: "var(--f-mono)",
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            letterSpacing: "0.06em",
          }}
        >
          Open chat
        </button>
      </aside>
    );
  }

  return (
    <aside
      data-component="onboarding-chat-panel"
      data-collapsed="false"
      aria-label="Onboarding chat"
      className={className}
      style={{
        width: 360,
        flexShrink: 0,
        borderLeft: "1px solid var(--rule)",
        background: "var(--paper)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: "1px solid var(--rule)",
          background: "var(--paper-2)",
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 2 }}>Interview</div>
          <h2
            style={{
              fontFamily: "var(--f-serif)",
              fontSize: 15,
              letterSpacing: "-0.01em",
              margin: 0,
            }}
          >
            Onboarding chat
          </h2>
        </div>
        <button
          type="button"
          aria-label="Collapse onboarding chat"
          aria-expanded={true}
          onClick={onToggleCollapsed}
          style={{
            appearance: "none",
            background: "transparent",
            border: "1px solid var(--rule)",
            borderRadius: 3,
            color: "var(--ink-2)",
            cursor: "pointer",
            padding: "4px 8px",
            fontSize: 12,
            fontFamily: "var(--f-mono)",
          }}
        >
          ✕
        </button>
      </header>

      <div
        ref={scrollRef}
        aria-label="Conversation"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {history.length === 0 && (
          <p style={{ color: "var(--ink-3)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
            Send a message to start. The agent will read your profile, ask a question, and save your answers as it goes.
          </p>
        )}
        {history.map((turn, i) => (
          <div
            key={i}
            data-role={turn.role}
            style={{
              alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "90%",
              padding: "8px 10px",
              borderRadius: 3,
              background: turn.role === "user" ? "var(--paper-2)" : "transparent",
              border: turn.role === "user" ? "1px solid var(--rule)" : "none",
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              color: "var(--ink)",
            }}
          >
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", marginBottom: 2 }}>
              {turn.role === "user" ? "you" : "agent"}
            </div>
            {turn.content || (turn.role === "assistant" && streaming ? "…" : "")}
          </div>
        ))}
        {toolEvents.length > 0 && (
          <ul aria-label="Tool activity" style={{ listStyle: "none", padding: 0, margin: 0, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>
            {toolEvents.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--err, crimson)", fontSize: 12, margin: 0, padding: "0 12px" }}>
          {error}
        </p>
      )}

      <form onSubmit={submit} style={{ display: "flex", gap: 6, padding: 10, borderTop: "1px solid var(--rule)" }}>
        <input
          aria-label="Message"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={streaming ? "Streaming…" : "Type your answer"}
          disabled={streaming}
          style={{
            flex: 1,
            padding: "7px 10px",
            border: "1px solid var(--rule-strong)",
            borderRadius: 3,
            background: "var(--paper)",
            color: "var(--ink)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <Button type="submit" variant="primary" size="sm" disabled={streaming || !input.trim()}>
          Send
        </Button>
      </form>
    </aside>
  );
}
