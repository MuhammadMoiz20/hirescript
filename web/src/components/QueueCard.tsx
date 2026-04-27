import { useEffect, useState } from "react";
import { Application, ApplicationDetail, api } from "../api";
import Button from "./ui/Button";
import PdfPreview from "./PdfPreview";
import StatusPill, { type StatusKind } from "./ui/StatusPill";
import TierBadge, { type Tier } from "./ui/TierBadge";
import FitChip from "./ui/FitChip";

interface Props {
  application: Application;
  onSubmit: (id: number) => void;
  onCancel: (id: number) => void;
  submitting?: boolean;
  cancelling?: boolean;
}

function fmtElapsed(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "queued", "running", "ok", "failed", "cancelled", "paused", "stuck",
  "errored", "prepared", "submitted", "duplicate_skipped",
]);

const KNOWN_TIERS: ReadonlySet<string> = new Set(["dream", "targeted", "wide", "skip"]);

export default function QueueCard({ application, onSubmit, onCancel, submitting, cancelling }: Props) {
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingCover, setEditingCover] = useState(false);
  const [coverDraft, setCoverDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getApplication(application.id)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setCoverDraft(d.cover_letter_text || "");
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.detail ? String(e.detail) : e?.message || "Failed to load application");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [application.id]);

  // Fetch the tailored resume PDF as a Blob so PdfPreview can render it.
  useEffect(() => {
    let cancelled = false;
    if (!detail?.resume_pdf_url) {
      setPdfBlob(null);
      return;
    }
    fetch(detail.resume_pdf_url, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!cancelled) setPdfBlob(blob);
      })
      .catch(() => {
        if (!cancelled) setPdfBlob(null);
      });
    return () => { cancelled = true; };
  }, [detail?.resume_pdf_url]);

  const isErrored = application.status === "errored";
  const submitLabel = isErrored ? "Retry submit" : "Submit application";
  const statusKind: StatusKind | null = KNOWN_STATUSES.has(application.status)
    ? (application.status as StatusKind)
    : null;
  const tier = application.posting.tier;
  const tierKind: Tier | null = tier && KNOWN_TIERS.has(tier) ? (tier as Tier) : null;

  const formEntries = detail?.form_payload
    ? Object.entries(detail.form_payload)
    : [];

  return (
    <article
      data-testid="queue-card"
      data-application-id={application.id}
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 4,
        background: "var(--paper)",
        marginBottom: 12,
        overflow: "hidden",
      }}
    >
      {/* Header — bundle-styled mono key/value strip with badges. */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: "1px solid var(--rule)",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            {application.posting.company || "Unknown"} · {application.posting.title}
          </div>
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {application.posting.location && <span>{application.posting.location}</span>}
            <span>mode: {application.mode}</span>
            {detail?.prepared_at && <span>prepared {fmtElapsed(detail.prepared_at)} ago</span>}
            {detail?.canonical_key && <span>{detail.canonical_key}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {tierKind && <TierBadge tier={tierKind} />}
          {application.posting.fit_score != null && (
            <FitChip score={application.posting.fit_score} />
          )}
          {statusKind ? (
            <StatusPill status={statusKind} />
          ) : (
            <span
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10,
                padding: "2px 7px",
                border: "1px solid var(--rule-strong)",
                borderRadius: 999,
                color: "var(--ink-3)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {application.status}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" style={{
          fontSize: 12.5,
          padding: "8px 14px",
          background: "color-mix(in oklch, var(--accent) 10%, var(--paper))",
          color: "var(--ink)",
          borderBottom: "1px solid var(--rule)",
        }}>
          {error}
        </div>
      )}

      {isErrored && application.error && (
        <div role="alert" style={{
          fontSize: 12.5,
          padding: "8px 14px",
          background: "color-mix(in oklch, var(--err) 10%, var(--paper))",
          color: "var(--ink)",
          borderBottom: "1px solid var(--rule)",
        }}>
          <strong>Submission error:</strong> {application.error}
        </div>
      )}

      {/* Body: resume + content side by side */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          minHeight: 320,
        }}
        className="queue-card-body"
      >
        <div data-testid="app-resume-pane" style={{ borderRight: "1px solid var(--rule)", minHeight: 320, background: "var(--paper-2)" }}>
          {loading ? (
            <div style={{ padding: 20, fontSize: 13, color: "var(--ink-3)" }}>Loading resume…</div>
          ) : pdfBlob ? (
            <PdfPreview pdfBlob={pdfBlob} />
          ) : (
            <div style={{ padding: 20, fontSize: 13, color: "var(--ink-3)" }}>
              No tailored resume available.
            </div>
          )}
        </div>

        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflowY: "auto" }}>
          <section>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}>
              <h3 data-testid="app-cover-letter-heading" className="eyebrow" style={{ margin: 0 }}>Cover letter</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditingCover((v) => {
                    const next = !v;
                    if (!next) {
                      // Exiting edit mode: discard draft, reset to source.
                      setCoverDraft(detail?.cover_letter_text || application.cover_letter_text || "");
                    }
                    return next;
                  });
                }}
              >
                {editingCover ? "Done" : "Edit (preview only)"}
              </Button>
            </div>
            {editingCover ? (
              <>
                <div style={{
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  marginBottom: 6,
                  fontStyle: "italic",
                }}>
                  Edits are not saved or submitted yet. Submit will use the original cover letter.
                </div>
                <textarea
                  value={coverDraft}
                  onChange={(e) => setCoverDraft(e.target.value)}
                  aria-label="Cover letter editor"
                  rows={10}
                  style={{
                    width: "100%",
                    fontFamily: "var(--f-sans)",
                    fontSize: 13,
                    lineHeight: 1.5,
                    border: "1px solid var(--rule-strong)",
                    borderRadius: 3,
                    padding: 8,
                    background: "var(--paper)",
                    color: "var(--ink)",
                    resize: "vertical",
                  }}
                />
              </>
            ) : (
              <pre style={{
                whiteSpace: "pre-wrap",
                fontFamily: "var(--f-sans)",
                fontSize: 13,
                lineHeight: 1.5,
                margin: 0,
                color: "var(--ink)",
              }}>
                {application.cover_letter_text || "(none)"}
              </pre>
            )}
          </section>

          {formEntries.length > 0 && (
            <section>
              <h3 className="eyebrow" style={{ margin: "0 0 6px" }}>Form responses</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <tbody>
                  {formEntries.map(([k, v]) => (
                    <tr key={k} style={{ borderTop: "1px solid var(--rule)" }}>
                      <td style={{ padding: "6px 6px", color: "var(--ink-3)", verticalAlign: "top", width: "40%" }}>
                        {k}
                      </td>
                      <td style={{ padding: "6px 6px", color: "var(--ink)", verticalAlign: "top" }}>
                        {typeof v === "string" ? v : JSON.stringify(v)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: "flex",
        gap: 8,
        padding: "10px 14px",
        borderTop: "1px solid var(--rule)",
        background: "var(--paper-2)",
        flexWrap: "wrap",
      }}>
        <Button
          size="sm"
          variant="primary"
          data-testid="app-submit-btn"
          disabled={submitting || application.status === "submitted" || application.status === "submitting"}
          onClick={() => onSubmit(application.id)}
        >
          {submitting ? "Submitting…" : submitLabel}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={cancelling}
          onClick={() => {
            const ok = window.confirm("Cancel this application? This will delete it.");
            if (ok) onCancel(application.id);
          }}
        >
          {cancelling ? "Cancelling…" : "Cancel application"}
        </Button>
      </div>
    </article>
  );
}
