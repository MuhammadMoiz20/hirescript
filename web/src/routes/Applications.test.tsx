import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Applications from "./Applications";
import { beforeEach, vi, test, expect } from "vitest";

const mockApi = vi.hoisted(() => ({
  listApplications: vi.fn(),
  getApplication: vi.fn(),
  submitApplication: vi.fn(),
  deleteApplication: vi.fn(),
}));

vi.mock("../api", () => ({ api: mockApi }));

// PdfPreview drags in pdfjs-dist + a worker URL import; not relevant here.
vi.mock("../components/PdfPreview", () => ({
  default: () => <div data-testid="pdf-preview-stub">[pdf]</div>,
}));

const samplePosting = {
  id: 1,
  source: "greenhouse",
  source_job_id: "g-1",
  company: "Acme Corp",
  title: "Senior Engineer",
  location: "Remote",
  apply_url: "https://example.com/apply/1",
  tier: "dream",
  fit_score: 88,
  status: "prepared",
  ingested_at: "2026-04-25T12:00:00Z",
};

const sampleApp = {
  id: 7,
  posting_id: 1,
  posting: samplePosting,
  status: "prepared",
  mode: "B" as const,
  cover_letter_text: "Dear hiring team,\nI am excited…",
  form_payload: { "Why this role?": "Mission alignment." },
  submitted_at: null,
  error: null,
};

const sampleAppDetail = {
  ...sampleApp,
  resume_pdf_url: null,
  canonical_key: "acme-senior-engineer",
  prepared_at: "2026-04-26T12:00:00Z",
  confirmation_html: null,
  confirmation_screenshot_path: null,
};

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  mockApi.listApplications.mockResolvedValue({ items: [sampleApp], total: 1 });
  mockApi.getApplication.mockResolvedValue(sampleAppDetail);
});

function renderApplications(navigate?: (p: string) => void) {
  return render(
    <MemoryRouter>
      <Applications navigateOverride={navigate} />
    </MemoryRouter>,
  );
}

test("renders prepared applications", async () => {
  renderApplications();
  await waitFor(() => expect(mockApi.listApplications).toHaveBeenCalled());
  expect(await screen.findByText(/Acme Corp · Senior Engineer/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /submit application/i })).toBeInTheDocument();
});

test("clicking Submit calls submitApplication and navigates", async () => {
  mockApi.submitApplication.mockResolvedValue({ job_id: "job-uuid-1" });
  const navigate = vi.fn();
  renderApplications(navigate);
  await screen.findByText(/Acme Corp · Senior Engineer/);

  fireEvent.click(screen.getByRole("button", { name: /submit application/i }));

  await waitFor(() => expect(mockApi.submitApplication).toHaveBeenCalledWith(7));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/jobs?job=job-uuid-1"));
});

test("clicking Cancel deletes the application and removes the card", async () => {
  mockApi.deleteApplication.mockResolvedValue(undefined);
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

  renderApplications();
  await screen.findByText(/Acme Corp · Senior Engineer/);

  fireEvent.click(screen.getByRole("button", { name: /cancel application/i }));

  await waitFor(() => expect(mockApi.deleteApplication).toHaveBeenCalledWith(7));
  await waitFor(() => expect(screen.queryByText(/Acme Corp · Senior Engineer/)).not.toBeInTheDocument());

  confirmSpy.mockRestore();
});

test("errored card shows error string and Retry submit", async () => {
  const errored = {
    ...sampleApp,
    id: 8,
    status: "errored",
    error: "Greenhouse form selector not found",
  };
  mockApi.listApplications.mockResolvedValue({ items: [errored], total: 1 });
  mockApi.getApplication.mockResolvedValue({
    ...sampleAppDetail,
    ...errored,
  });

  renderApplications();
  await screen.findByText(/Acme Corp · Senior Engineer/);
  expect(screen.getByText(/Greenhouse form selector not found/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /retry submit/i })).toBeInTheDocument();
});
