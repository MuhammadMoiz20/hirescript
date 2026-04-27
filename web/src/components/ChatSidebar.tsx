import { useEffect, useRef, useState } from "react";
import { api, ChatTurn, EditResult, Tier } from "../api";
import Glyph from "./ui/Glyph";
import Button from "./ui/Button";
import ModelBadge, { ModelName } from "./ui/ModelBadge";
import CompileChip from "./ui/CompileChip";

type AssistantMessage = {
  role: "assistant";
  text: string;
  status: "streaming" | "done" | "error";
  result?: EditResult;
};

/**
 * Strip the JSON envelope (and anything after a leading fence opener) from
 * the assistant's streamed text so the user only sees prose, never the
 * `latex` payload Claude emits at the end of edit replies.
 */
function visiblePart(text: string): string {
  // Hide everything from a ```json fence onward.
  const fenceIdx = text.indexOf("```json");
  if (fenceIdx !== -1) return text.slice(0, fenceIdx).trimEnd();
  // Hide a trailing bare JSON object that contains "latex":
  const m = text.match(/^([\s\S]*?)\{[^{}]*"latex"\s*:[\s\S]*$/);
  if (m) return m[1].trimEnd();
  // Hide a leading ``` fence opener mid-stream while the model is still
  // forming the envelope.
  const tickIdx = text.indexOf("```");
  if (tickIdx !== -1) return text.slice(0, tickIdx).trimEnd();
  return text;
}

type UserMessage = { role: "user"; text: string };

type Message = UserMessage | AssistantMessage;

interface Props {
  resumeId: number;
  onProposed: (result: EditResult) => void;
  defaultTier?: Tier;
  /**
   * Returns the latex currently in the editor at send time. Used so chat
   * edits operate on unsaved changes, not on the last persisted version.
   * Optional — when omitted, the backend falls back to the DB value.
   */
  getCurrentLatex?: () => string;
  /**
   * Optional collapse handler. When provided the rail header surfaces a
   * `panel-r` close affordance (bundle: `screens-a.jsx::ChatRail`). Mobile
   * drawer callers leave this undefined and rely on the drawer chrome.
   */
  onClose?: () => void;
}

const TIER_TO_MODEL: Record<Tier, ModelName> = {
  haiku: "haiku",
  sonnet: "sonnet",
  opus: "opus",
};

export default function ChatSidebar({
  resumeId,
  onProposed,
  defaultTier = "haiku",
  getCurrentLatex,
  onClose,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [tier, setTier] = useState<Tier>(defaultTier);
  const [streaming, setStreaming] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: 9e9 });
    }
  }, [messages]);

  const updateLastAssistant = (updater: (msg: AssistantMessage) => AssistantMessage) => {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next[i] = updater(next[i] as AssistantMessage);
          break;
        }
      }
      return next;
    });
  };

  /**
   * Build the chat history payload from prior turns. We send only prose (the
   * user-visible portion of assistant replies), never the raw JSON envelope,
   * so the model gets clean conversational context. Skip in-flight or errored
   * turns.
   */
  const buildHistory = (): ChatTurn[] => {
    const turns: ChatTurn[] = [];
    for (const m of messages) {
      if (m.role === "user") {
        turns.push({ role: "user", content: m.text });
      } else if (m.status === "done") {
        const visible = visiblePart(m.text).trim();
        if (visible) turns.push({ role: "assistant", content: visible });
      }
    }
    return turns;
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    const history = buildHistory();
    const currentLatex = getCurrentLatex?.();
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", text: trimmed },
      { role: "assistant", text: "", status: "streaming" },
    ]);
    setInput("");

    try {
      await api.streamEdit(
        resumeId,
        trimmed,
        tier,
        {
          onChunk: (text: string) => {
            updateLastAssistant((msg) => ({ ...msg, text: msg.text + text }));
          },
          onResult: (result: EditResult) => {
            updateLastAssistant((msg) => ({ ...msg, status: "done", result }));
            onProposed(result);
            setStreaming(false);
          },
          onError: (errMsg: string) => {
            updateLastAssistant((msg) => ({
              ...msg,
              status: "error",
              text: msg.text + (msg.text ? "\n" : "") + errMsg,
            }));
            setStreaming(false);
          },
        },
        undefined,
        { history, currentLatex },
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      updateLastAssistant((msg) => ({
        ...msg,
        status: "error",
        text: msg.text + (msg.text ? "\n" : "") + errMsg,
      }));
      setStreaming(false);
    }
  };

  const handleClear = () => {
    if (streaming) return;
    setMessages([]);
    setInput("");
  };

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: "var(--paper)",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <Glyph name="chat" size={13} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>Claude</span>
        <ModelBadge model={TIER_TO_MODEL[tier]} size="sm" />
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={handleClear}
          disabled={streaming || messages.length === 0}
          aria-label="Clear chat"
          title="Clear chat and start fresh"
          className="mono"
          style={{
            fontSize: 11,
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            color: "var(--ink-2)",
            borderRadius: 2,
            padding: "2px 6px",
            cursor: streaming || messages.length === 0 ? "not-allowed" : "pointer",
            opacity: streaming || messages.length === 0 ? 0.5 : 1,
          }}
        >
          Clear
        </button>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as Tier)}
          disabled={streaming}
          aria-label="Tier"
          className="mono"
          style={{
            fontSize: 11,
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            color: "var(--ink-2)",
            borderRadius: 2,
            padding: "2px 4px",
          }}
        >
          <option value="haiku">Haiku</option>
          <option value="sonnet">Sonnet</option>
          <option value="opus">Opus</option>
        </select>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            title="Collapse chat"
            style={{
              color: "var(--ink-3)",
              padding: 4,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <Glyph name="panel-r" size={13} />
          </button>
        )}
      </div>

      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              padding: 10,
              border: "1px dashed var(--rule-strong)",
              borderRadius: 3,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              color: "var(--ink-2)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <Glyph name="sparkle" size={13} />
            <div>
              <b style={{ color: "var(--ink)" }}>Ask Claude</b> to edit, tighten, or tailor your
              resume. Edits land as a reviewable diff.
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          if (m.role === "user") {
            return (
              <div
                key={i}
                style={{
                  alignSelf: "flex-end",
                  maxWidth: "85%",
                  background: "var(--paper-2)",
                  border: "1px solid var(--rule)",
                  borderRadius: 3,
                  padding: "8px 10px",
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.text}
              </div>
            );
          }
          // assistant
          const showCaret = isLast && streaming && m.status === "streaming";
          const visible = visiblePart(m.text);
          const isEdit = m.status === "done" && m.result?.proposed_latex;
          return (
            <div
              key={i}
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                color: m.status === "error" ? "var(--err)" : "var(--ink)",
              }}
            >
              {visible && (
                <div className={showCaret ? "caret" : ""} style={{ whiteSpace: "pre-wrap" }}>
                  {visible}
                </div>
              )}
              {!visible && showCaret && <div className="caret" />}
              {!visible && m.status === "error" && (
                <div style={{ color: "var(--err)" }}>Error</div>
              )}
              {isEdit && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    border: "1px solid var(--rule)",
                    borderRadius: 3,
                    background: "var(--paper-2)",
                    fontSize: 12,
                  }}
                >
                  <Glyph name="check" size={12} />
                  <span style={{ color: "var(--ink-2)" }}>
                    Edit drafted — review the diff in the preview pane.
                  </span>
                </div>
              )}
              {m.status === "done" && m.result && (
                <CompileChip
                  iterations={m.result.iterations}
                  pageCount={m.result.page_count}
                  kind="done"
                />
              )}
            </div>
          );
        })}
      </div>

      <div style={{ padding: 10, borderTop: "1px solid var(--rule)", flexShrink: 0 }}>
        <div
          style={{
            border: "1px solid var(--rule-strong)",
            borderRadius: 3,
            padding: 6,
            background: "var(--paper)",
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={streaming}
            rows={3}
            placeholder="Ask Claude to edit, tighten, or tailor…"
            aria-label="Chat instruction"
            style={{
              width: "100%",
              minHeight: 52,
              border: "none",
              outline: "none",
              resize: "none",
              background: "transparent",
              padding: "2px 4px",
              fontSize: 13,
              color: "var(--ink)",
              fontFamily: "var(--f-sans)",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 4px 2px",
              flexWrap: "wrap",
            }}
          >
            {(["Tighten to 1 page", "Tailor to JD"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setInput(preset)}
                disabled={streaming}
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--ink-2)",
                  padding: "2px 7px",
                  border: "1px solid var(--rule)",
                  borderRadius: 2,
                  background: "var(--paper-2)",
                  cursor: streaming ? "not-allowed" : "pointer",
                  opacity: streaming ? 0.5 : 1,
                }}
              >
                {preset}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <Button
              size="sm"
              variant="primary"
              mono
              onClick={handleSend}
              disabled={streaming || !input.trim()}
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
