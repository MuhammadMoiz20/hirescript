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
  /** Slice 3: invoked after the user manually submitted a captcha-paused
   * application. Restores `mode="A"` so the autonomous loop owns it again. */
  onResumeA?: (id: number) => void;
  /** Slice 3: invoked from the verify-blocked banner — should route to the
   * existing edit affordance (handled by the parent route). */
  onEditAndRetry?: (id: number) => void;
  /** Slice 5: invoked when the user authorizes a paused browser-agent submit
   * (status === "awaiting_confirmation"). */
  onConfirmAgent?: (id: number) => void;
  submitting?: boolean;
  cancelling?: boolean;
  resumingA?: boolean;
  confirmingAgent?: boolean;
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
// `captcha_pause` is a slice-3 application status. StatusPill doesn't have a
// canonical glyph for it yet (it would belong on the per-application level,
// not the run-pill set), so we render the captcha banner in its place.

const KNOWN_TIERS: ReadonlySet<string> = new Set(["dream", "targeted", "wide", "skip"]);

const COVER_LETTER_LABELS: Record<NonNullable<Application["cover_letter_requirement"]>, string> = {
  required: "Cover letter required",
  optional: "Cover letter optional",
  not_present: "No cover letter field",
  unknown: "Cover letter unknown",
};

export default function QueueCard({
  application,
  onSubmit,
  onCancel,
  onResumeA,
  onEditAndRetry,
  onConfirmAgent,
  submitting,
  cancelling,
  resumingA,
  confirmingAgent,
}: Props) {
  const [verifyOpen, setVerifyOpen] = useState(false);
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
          {application.mode === "A" && (
            <span
              data-testid="queue-card-mode-a"
              title="A-mode: autonomous submit"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10,
                padding: "2px 7px",
                border: "1px solid var(--sonnet)",
                color: "var(--sonnet)",
                borderRadius: 999,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              A · auto
            </span>
          )}
          {tierKind && <TierBadge tier={tierKind} />}
          {application.cover_letter_requirement && (
            <span
              data-testid="cover-letter-badge"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 10,
                padding: "2px 7px",
                border: "1px solid var(--rule-strong)",
                borderRadius: 999,
                color: "var(--ink-2)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {COVER_LETTER_LABELS[application.cover_letter_requirement]}
            </span>
          )}
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

      {application.status === "captcha_pause" && (
        <div
          role="alert"
          data-testid="queue-card-captcha-banner"
          style={{
            fontSize: 12.5,
            padding: "10px 14px",
            background: "color-mix(in oklch, var(--warn) 12%, var(--paper))",
            color: "var(--ink)",
            borderBottom: "1px solid var(--rule)",
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong>Captcha required</strong> — resolve manually then resume A-mode.
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>
              Step 1: open the apply page and submit by hand. Step 2: tap
              "Resolve & resume A" to hand the application back to the
              autonomous loop.
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            data-testid="queue-card-resume-a-btn"
            disabled={!onResumeA || resumingA}
            onClick={() => onResumeA?.(application.id)}
          >
            {resumingA ? "Resuming…" : "Resolve & resume A"}
          </Button>
        </div>
      )}

      {application.status === "awaiting_confirmation" && (
        <div
          role="alert"
          data-testid="queue-card-confirm-agent-banner"
          style={{
            fontSize: 12.5,
            padding: "10px 14px",
            background: "color-mix(in oklch, var(--warn) 12%, var(--paper))",
            color: "var(--ink)",
            borderBottom: "1px solid var(--rule)",
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong>Agent paused at submit</strong> — review the form
            responses below, then confirm to authorize the browser agent to
            click submit on your behalf.
          </div>
          <Button
            size="sm"
            variant="primary"
            data-testid="queue-card-confirm-agent-btn"
            disabled={!onConfirmAgent || confirmingAgent}
            onClick={() => onConfirmAgent?.(application.id)}
          >
            {confirmingAgent ? "Confirming…" : "Confirm & submit"}
          </Button>
        </div>
      )}

      {application.verify_ok === false && (
        <div
          role="alert"
          data-testid="queue-card-verify-banner"
          style={{
            fontSize: 12.5,
            padding: "10px 14px",
            background: "color-mix(in oklch, var(--err) 10%, var(--paper))",
            color: "var(--ink)",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <strong>Verifier flagged unsupported claims.</strong>{" "}
              {application.verify_rationale && (
                <span style={{ color: "var(--ink-2)" }}>
                  {application.verify_rationale}
                </span>
              )}
            </div>
            {application.verify_issues.length > 0 && (
              <button
                type="button"
                data-testid="queue-card-verify-toggle"
                onClick={() => setVerifyOpen((v) => !v)}
                aria-expanded={verifyOpen}
                style={{
                  background: "transparent",
                  border: "1px solid var(--rule-strong)",
                  borderRadius: 3,
                  padding: "4px 8px",
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  cursor: "pointer",
                  color: "var(--ink-2)",
                }}
              >
                {verifyOpen
                  ? `Hide ${application.verify_issues.length} issue${application.verify_issues.length === 1 ? "" : "s"}`
                  : `Show ${application.verify_issues.length} issue${application.verify_issues.length === 1 ? "" : "s"}`}
              </button>
            )}
            <Button
              size="sm"
              variant="primary"
              data-testid="queue-card-verify-edit-btn"
              disabled={!onEditAndRetry}
              onClick={() => onEditAndRetry?.(application.id)}
            >
              Edit &amp; retry
            </Button>
          </div>
          {verifyOpen && application.verify_issues.length > 0 && (
            <ul
              data-testid="queue-card-verify-issues"
              style={{
                margin: "8px 0 0 18px",
                padding: 0,
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--ink-2)",
              }}
            >
              {application.verify_issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
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

          {detail?.research && detail.research.brief_md && (
            <section data-testid="application-research-panel">
              <h3 className="eyebrow" style={{ margin: "0 0 6px" }}>
                Company brief · dream tier
              </h3>
              <pre style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontFamily: "var(--f-sans)",
                fontSize: 13,
                lineHeight: 1.5,
                margin: 0,
                color: "var(--ink)",
              }}>
                {detail.research.brief_md}
              </pre>
              {detail.research.signals_json && (
                <ul style={{
                  margin: "8px 0 0",
                  paddingLeft: 18,
                  fontSize: 12,
                  color: "var(--ink-2)",
                  lineHeight: 1.5,
                }}>
                  {(detail.research.signals_json.recent_news || []).map((n, i) => (
                    <li key={`news-${i}`} data-testid="research-signal-news">
                      <strong>News:</strong> {n}
                    </li>
                  ))}
                  {(detail.research.signals_json.hiring_signals || []).map((n, i) => (
                    <li key={`hire-${i}`} data-testid="research-signal-hiring">
                      <strong>Hiring:</strong> {n}
                    </li>
                  ))}
                  {(detail.research.signals_json.people || []).map((n, i) => (
                    <li key={`ppl-${i}`} data-testid="research-signal-people">
                      <strong>People:</strong> {n}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mono" style={{
                marginTop: 6,
                fontSize: 10,
                color: "var(--ink-4)",
                letterSpacing: "0.04em",
              }}>
                {detail.research.model}
              </div>
            </section>
          )}

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
          disabled={
            submitting ||
            application.status === "submitted" ||
            application.status === "submitting" ||
            application.status === "awaiting_confirmation"
          }
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
