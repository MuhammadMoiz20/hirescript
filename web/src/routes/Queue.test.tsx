import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Queue, { applicationToLane } from "./Queue";
import { beforeEach, vi, test, expect, describe } from "vitest";

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

function renderQueue(navigate?: (p: string) => void) {
  return render(
    <MemoryRouter>
      <Queue navigateOverride={navigate} />
    </MemoryRouter>,
  );
}

describe("applicationToLane", () => {
  test("errored → needs_you", () => {
    expect(applicationToLane({ ...sampleApp, status: "errored" })).toBe("needs_you");
  });
  test("stuck → needs_you", () => {
    expect(applicationToLane({ ...sampleApp, status: "stuck" })).toBe("needs_you");
  });
  test("prepared B-mode → b_mode", () => {
    expect(applicationToLane({ ...sampleApp, status: "prepared", mode: "B" })).toBe("b_mode");
  });
  test("submitting → applying", () => {
    expect(applicationToLane({ ...sampleApp, status: "submitting" })).toBe("applying");
  });
  test("paused → paused", () => {
    expect(applicationToLane({ ...sampleApp, status: "paused" })).toBe("paused");
  });
  test("submitted → null (filtered out)", () => {
    expect(applicationToLane({ ...sampleApp, status: "submitted" })).toBe(null);
  });
});

test("renders all four lane headers with counters", async () => {
  renderQueue();
  await waitFor(() => expect(mockApi.listApplications).toHaveBeenCalled());

  // Lane containers
  expect(screen.getByTestId("queue-lane-needs_you")).toBeInTheDocument();
  expect(screen.getByTestId("queue-lane-b_mode")).toBeInTheDocument();
  expect(screen.getByTestId("queue-lane-applying")).toBeInTheDocument();
  expect(screen.getByTestId("queue-lane-paused")).toBeInTheDocument();

  // Lane labels visible as headings
  expect(screen.getByRole("heading", { name: "Needs you" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "B-mode" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Applying" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Paused" })).toBeInTheDocument();

  // Counters: B-mode=1, others=0
  await waitFor(() =>
    expect(screen.getByTestId("queue-lane-count-b_mode")).toHaveTextContent("1"),
  );
  expect(screen.getByTestId("queue-lane-count-needs_you")).toHaveTextContent("0");
  expect(screen.getByTestId("queue-lane-count-applying")).toHaveTextContent("0");
  expect(screen.getByTestId("queue-lane-count-paused")).toHaveTextContent("0");
});

test("prepared B-mode application renders inside the B-mode lane", async () => {
  renderQueue();
  await waitFor(() => expect(mockApi.listApplications).toHaveBeenCalled());

  const bLane = await screen.findByTestId("queue-lane-b_mode");
  expect(within(bLane).getByText(/Acme Corp · Senior Engineer/)).toBeInTheDocument();
  expect(within(bLane).getByRole("button", { name: /submit application/i })).toBeInTheDocument();
});

test("empty future lanes show 'Coming in Slice 3' placeholder", async () => {
  renderQueue();
  await waitFor(() => expect(mockApi.listApplications).toHaveBeenCalled());

  expect(await screen.findByTestId("queue-lane-empty-applying")).toHaveTextContent(/Coming in Slice 3/i);
  expect(screen.getByTestId("queue-lane-empty-paused")).toHaveTextContent(/Coming in Slice 3/i);
  // needs_you is current-slice — uses the generic placeholder.
  expect(screen.getByTestId("queue-lane-empty-needs_you")).toHaveTextContent(/nothing here/i);
});

test("clicking Submit calls submitApplication and navigates", async () => {
  mockApi.submitApplication.mockResolvedValue({ job_id: "job-uuid-1" });
  const navigate = vi.fn();
  renderQueue(navigate);
  await screen.findByText(/Acme Corp · Senior Engineer/);

  fireEvent.click(screen.getByRole("button", { name: /submit application/i }));

  await waitFor(() => expect(mockApi.submitApplication).toHaveBeenCalledWith(7));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/jobs?job=job-uuid-1"));
});

test("clicking Cancel deletes the application and removes the card", async () => {
  mockApi.deleteApplication.mockResolvedValue(undefined);
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

  renderQueue();
  await screen.findByText(/Acme Corp · Senior Engineer/);

  fireEvent.click(screen.getByRole("button", { name: /cancel application/i }));

  await waitFor(() => expect(mockApi.deleteApplication).toHaveBeenCalledWith(7));
  await waitFor(() => expect(screen.queryByText(/Acme Corp · Senior Engineer/)).not.toBeInTheDocument());

  confirmSpy.mockRestore();
});

test("errored card lands in Needs you lane with error string and Retry submit", async () => {
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

  renderQueue();
  await screen.findByText(/Acme Corp · Senior Engineer/);

  const needsYou = screen.getByTestId("queue-lane-needs_you");
  expect(within(needsYou).getByText(/Acme Corp · Senior Engineer/)).toBeInTheDocument();
  expect(screen.getByText(/Greenhouse form selector not found/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /retry submit/i })).toBeInTheDocument();
  expect(screen.getByTestId("queue-lane-count-needs_you")).toHaveTextContent("1");
  expect(screen.getByTestId("queue-lane-count-b_mode")).toHaveTextContent("0");
});

test("page header renders Queue title", async () => {
  renderQueue();
  expect(screen.getByRole("heading", { name: /the agent's working surface/i })).toBeInTheDocument();
});
