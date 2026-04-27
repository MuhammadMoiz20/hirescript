/**
 * PasteUrlDialog — small modal for `POST /postings/from_url` (slice 4).
 *
 * The Inbox toolbar opens this dialog. On success, the parent receives the
 * newly-created `Posting` via `onCreated` and is responsible for selecting
 * or navigating to it. 422 errors render inline with the backend `detail`.
 */
import { useEffect, useRef, useState } from "react";
import { api, type Posting } from "../api";
import Button from "./ui/Button";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (posting: Posting) => void;
}

export default function PasteUrlDialog({ open, onClose, onCreated }: Props) {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      // Reset state and focus the input each time the dialog opens.
      setUrl("");
      setError(null);
      setSubmitting(false);
      // requestAnimationFrame so the input is in the DOM before .focus().
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const posting = await api.pasteJobUrl(url.trim());
      onCreated(posting);
    } catch (e: any) {
      setError(
        e?.detail ? String(e.detail) : e?.message || "Failed to paste URL",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paste job URL"
      data-testid="paste-url-dialog"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in oklch, var(--ink) 28%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          padding: 18,
          width: 480,
          maxWidth: "92vw",
          boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            marginBottom: 4,
          }}
        >
          Paste job URL
        </div>
        <h2
          style={{
            fontFamily: "var(--f-serif)",
            fontSize: 18,
            margin: "0 0 10px",
            color: "var(--ink)",
          }}
        >
          Ingest one posting
        </h2>
        <div
          style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12 }}
        >
          Greenhouse, Lever, Ashby, and Workable URLs are recognized. Anything
          else returns a 422.
        </div>
        <input
          ref={inputRef}
          type="url"
          required
          data-testid="paste-url-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://boards.greenhouse.io/anthropic/jobs/12345"
          aria-label="Job URL"
          style={{
            width: "100%",
            fontFamily: "var(--f-mono)",
            fontSize: 12,
            padding: "8px 10px",
            border: "1px solid var(--rule)",
            background: "var(--paper-2)",
            color: "var(--ink)",
            borderRadius: 3,
            boxSizing: "border-box",
          }}
        />
        {error && (
          <div
            role="alert"
            data-testid="paste-url-error"
            style={{
              marginTop: 10,
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
        <div
          style={{
            marginTop: 14,
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="paste-url-cancel"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            data-testid="paste-url-submit"
            disabled={submitting || !url.trim()}
          >
            {submitting ? "Ingesting…" : "Ingest"}
          </Button>
        </div>
      </form>
    </div>
  );
}
