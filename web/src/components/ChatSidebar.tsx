import { useState } from "react";
import { api, EditResult, Tier } from "../api";

type AssistantMessage = {
  role: "assistant";
  text: string;
  status: "streaming" | "done" | "error";
  result?: EditResult;
};

type UserMessage = { role: "user"; text: string };

type Message = UserMessage | AssistantMessage;

interface Props {
  resumeId: number;
  onProposed: (result: EditResult) => void;
  defaultTier?: Tier;
}

export default function ChatSidebar({ resumeId, onProposed, defaultTier = "haiku" }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [tier, setTier] = useState<Tier>(defaultTier);
  const [streaming, setStreaming] = useState(false);

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

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", text: trimmed },
      { role: "assistant", text: "", status: "streaming" },
    ]);
    setInput("");

    try {
      await api.streamEdit(resumeId, trimmed, tier, {
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
      });
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

  const renderSummary = (result: EditResult) => {
    const mark = result.enforced ? "\u2713" : "\u2717";
    const pages = `${result.page_count} page${result.page_count === 1 ? "" : "s"}`;
    const iters = `${result.iterations} iteration${result.iterations === 1 ? "" : "s"}`;
    const joiner = result.enforced ? "in" : "after";
    return `${mark} ${pages} ${joiner} ${iters}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 280 }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              margin: "6px 0",
              padding: 8,
              borderRadius: 6,
              background: m.role === "user" ? "#eef" : "#f5f5f5",
              whiteSpace: "pre-wrap",
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>
              {m.role === "user" ? "You" : "Assistant"}
            </div>
            <div>{m.text}</div>
            {m.role === "assistant" && m.status === "done" && m.result && (
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
                {renderSummary(m.result)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid #ddd", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
          rows={3}
          placeholder="Describe the edit..."
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier)}
            disabled={streaming}
            aria-label="Tier"
          >
            <option value="haiku">Haiku</option>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
          </select>
          <button onClick={handleSend} disabled={streaming || !input.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
