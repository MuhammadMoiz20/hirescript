import { useEffect, useRef, useState } from "react";
import { api, OnboardingTurn } from "../api";
import TopChrome from "../components/ui/TopChrome";
import Button from "../components/ui/Button";

interface Props {
  onBack?: () => void;
  initialHistory?: OnboardingTurn[];
}

export default function OnboardingChat({ onBack, initialHistory = [] }: Props) {
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
              setToolEvents((t) => [...t, `→ ${event.tool}(…)`]);
            } else if (event.type === "tool_result") {
              setToolEvents((t) => [...t, `✓ ${event.tool}`]);
            } else if (event.type === "tool_error") {
              setToolEvents((t) => [...t, `✗ ${event.tool}: ${event.error}`]);
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

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <TopChrome onLogoClick={onBack}>
        <span style={{ color: "var(--ink)" }}>Onboarding interview</span>
      </TopChrome>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", maxWidth: 760, width: "100%", margin: "0 auto", padding: "16px 16px 0" }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Interview</div>
        <h1 style={{ fontFamily: "var(--f-serif)", fontSize: 22, margin: "0 0 12px", letterSpacing: "-0.01em" }}>
          Answer a few questions
        </h1>

        <div
          ref={scrollRef}
          aria-label="Conversation"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            border: "1px solid var(--rule)",
            borderRadius: 3,
            background: "var(--paper)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {history.length === 0 && (
            <p style={{ color: "var(--ink-3)", fontSize: 13, margin: 0 }}>
              Send a message to start. The agent will read your profile, ask a question, and save your answers as it goes.
            </p>
          )}
          {history.map((turn, i) => (
            <div
              key={i}
              data-role={turn.role}
              style={{
                alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                padding: "8px 12px",
                borderRadius: 3,
                background: turn.role === "user" ? "var(--paper-2)" : "transparent",
                border: turn.role === "user" ? "1px solid var(--rule)" : "none",
                fontSize: 14,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                color: "var(--ink)",
              }}
            >
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginBottom: 2 }}>
                {turn.role === "user" ? "you" : "agent"}
              </div>
              {turn.content || (turn.role === "assistant" && streaming ? "…" : "")}
            </div>
          ))}
          {toolEvents.length > 0 && (
            <ul aria-label="Tool activity" style={{ listStyle: "none", padding: 0, margin: 0, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-3)" }}>
              {toolEvents.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" style={{ color: "var(--err, crimson)", fontSize: 13, margin: "8px 0 0" }}>
            {error}
          </p>
        )}

        <form onSubmit={submit} style={{ display: "flex", gap: 8, padding: "12px 0 16px" }}>
          <input
            aria-label="Message"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={streaming ? "Streaming…" : "Type your answer"}
            disabled={streaming}
            style={{
              flex: 1,
              padding: "10px 12px",
              border: "1px solid var(--rule)",
              borderRadius: 3,
              background: "var(--paper)",
              color: "var(--ink)",
              fontSize: 14,
              outline: "none",
            }}
          />
          <Button type="submit" variant="primary" disabled={streaming || !input.trim()}>
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
