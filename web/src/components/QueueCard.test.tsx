/**
 * QueueCard tests — slice-3 surface (A-mode badge, captcha banner, verify
 * banner). The card's internal `useEffect` calls `api.getApplication`; we mock
 * that out plus `PdfPreview` so tests stay synchronous.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import QueueCard from "./QueueCard";
import type { Application } from "../api";

const mockApi = vi.hoisted(() => ({
  getApplication: vi.fn(),
}));

vi.mock("../api", () => ({ api: mockApi }));
vi.mock("./PdfPreview", () => ({
  default: () => <div data-testid="pdf-preview-stub">[pdf]</div>,
}));

const samplePosting = {
  id: 1,
  source: "greenhouse",
  source_job_id: "g-1",
  company: "Acme",
  title: "Engineer",
  location: "Remote",
  apply_url: "https://example.com/apply/1",
  tier: "targeted",
  fit_score: 72,
  status: "prepared",
  ingested_at: "2026-04-25T12:00:00Z",
};

function app(over: Partial<Application> = {}): Application {
  return {
    id: 7,
    posting_id: 1,
    posting: samplePosting,
    status: "prepared",
    mode: "B",
    cover_letter_text: "Hello",
    form_payload: null,
    submitted_at: null,
    error: null,
    verify_ok: true,
    verify_issues: [],
    verify_rationale: null,
    ...over,
  };
}

beforeEach(() => {
  mockApi.getApplication.mockReset();
  mockApi.getApplication.mockResolvedValue({
    ...app(),
    resume_pdf_url: null,
    canonical_key: "acme-engineer",
    prepared_at: "2026-04-26T12:00:00Z",
    confirmation_html: null,
    confirmation_screenshot_path: null,
  });
});

function renderCard(application: Application, props: Partial<Parameters<typeof QueueCard>[0]> = {}) {
  return render(
    <QueueCard
      application={application}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  );
}

describe("QueueCard slice-3 surface", () => {
  test("renders A badge when mode='A'", async () => {
    renderCard(app({ mode: "A" }));
    expect(await screen.findByTestId("queue-card-mode-a")).toBeInTheDocument();
  });

  test("does not render A badge for B-mode", () => {
    renderCard(app({ mode: "B" }));
    expect(screen.queryByTestId("queue-card-mode-a")).not.toBeInTheDocument();
  });

  test("captcha_pause status renders the captcha banner", async () => {
    renderCard(app({ status: "captcha_pause", mode: "A" }));
    const banner = await screen.findByTestId("queue-card-captcha-banner");
    expect(banner).toHaveTextContent(/captcha required/i);
    expect(banner).toHaveTextContent(/resume a-mode/i);
  });

  test("Resolve & resume A click invokes onResumeA with the application id", async () => {
    const onResumeA = vi.fn();
    renderCard(app({ id: 99, status: "captcha_pause", mode: "A" }), { onResumeA });
    fireEvent.click(await screen.findByTestId("queue-card-resume-a-btn"));
    expect(onResumeA).toHaveBeenCalledWith(99);
  });

  test("verify_ok=false renders the verify banner", async () => {
    renderCard(
      app({
        verify_ok: false,
        verify_issues: ["Issue A", "Issue B"],
        verify_rationale: "Two issues.",
      }),
    );
    const banner = await screen.findByTestId("queue-card-verify-banner");
    expect(banner).toHaveTextContent(/unsupported claims/i);
    expect(banner).toHaveTextContent(/two issues/i);
  });

  test("verify issue list toggles on Show/Hide click", async () => {
    renderCard(
      app({
        verify_ok: false,
        verify_issues: ["Issue A", "Issue B"],
        verify_rationale: null,
      }),
    );
    expect(screen.queryByTestId("queue-card-verify-issues")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("queue-card-verify-toggle"));
    const list = await screen.findByTestId("queue-card-verify-issues");
    expect(list).toHaveTextContent("Issue A");
    expect(list).toHaveTextContent("Issue B");
    fireEvent.click(screen.getByTestId("queue-card-verify-toggle"));
    await waitFor(() =>
      expect(screen.queryByTestId("queue-card-verify-issues")).not.toBeInTheDocument(),
    );
  });

  test("Edit & retry click invokes onEditAndRetry with application id", async () => {
    const onEditAndRetry = vi.fn();
    renderCard(
      app({
        id: 314,
        verify_ok: false,
        verify_issues: ["x"],
        verify_rationale: null,
      }),
      { onEditAndRetry },
    );
    fireEvent.click(await screen.findByTestId("queue-card-verify-edit-btn"));
    expect(onEditAndRetry).toHaveBeenCalledWith(314);
  });

  test("verify banner suppressed when verify_ok is null (not yet verified)", () => {
    renderCard(app({ verify_ok: null }));
    expect(screen.queryByTestId("queue-card-verify-banner")).not.toBeInTheDocument();
  });
});
