import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Overview from "./Overview";
import { beforeEach, vi, test, expect } from "vitest";

const mockApi = vi.hoisted(() => ({
  listResumes: vi.fn(),
  listPostings: vi.fn(),
  listApplications: vi.fn(),
}));

vi.mock("../api", () => ({ api: mockApi }));

const todayIso = new Date().toISOString();
const earlierIso = "2026-04-20T12:00:00Z";

const sampleResumes = [
  { id: 1, name: "Master resume", template_id: "t1", latex_source: "%", updated_at: todayIso },
  { id: 2, name: "Backend resume", template_id: "t1", latex_source: "%", updated_at: earlierIso },
  { id: 3, name: "Infra resume", template_id: "t1", latex_source: "%", updated_at: earlierIso },
];

const samplePostings = [
  {
    id: 11,
    source: "greenhouse",
    source_job_id: "g-11",
    company: "Acme Corp",
    title: "Senior Engineer",
    location: "Remote",
    apply_url: "https://example.com/apply/11",
    tier: "dream",
    fit_score: 88,
    status: "classified",
    ingested_at: todayIso,
  },
  {
    id: 12,
    source: "greenhouse",
    source_job_id: "g-12",
    company: "Beta Labs",
    title: "Staff Engineer",
    location: "NYC",
    apply_url: "https://example.com/apply/12",
    tier: "targeted",
    fit_score: 65,
    status: "classified",
    ingested_at: earlierIso,
  },
];

const sampleApps = [
  {
    id: 101,
    posting_id: 11,
    posting: samplePostings[0],
    status: "prepared",
    mode: "B" as const,
    cover_letter_text: null,
    form_payload: null,
    submitted_at: null,
    error: null,
  },
  {
    id: 102,
    posting_id: 12,
    posting: samplePostings[1],
    status: "submitted",
    mode: "A" as const,
    cover_letter_text: null,
    form_payload: null,
    submitted_at: todayIso,
    error: null,
  },
];

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  mockApi.listResumes.mockResolvedValue(sampleResumes);
  mockApi.listPostings.mockResolvedValue({ items: samplePostings, total: 12 });
  mockApi.listApplications.mockResolvedValue({ items: sampleApps, total: 7 });
});

function renderOverview(navigate?: (p: string) => void) {
  return render(
    <MemoryRouter>
      <Overview navigateOverride={navigate} />
    </MemoryRouter>,
  );
}

test("renders left column with mocked resumes", async () => {
  renderOverview();
  await waitFor(() => expect(mockApi.listResumes).toHaveBeenCalled());
  const left = await screen.findByTestId("overview-resumes");
  expect(left).toHaveTextContent("Recent resumes");
  expect(await screen.findByText("Master resume")).toBeInTheDocument();
  expect(screen.getByText("Backend resume")).toBeInTheDocument();
  expect(screen.getByText("Infra resume")).toBeInTheDocument();
});

test("renders right column with MaxGauge expanded, counters, inbox, queue", async () => {
  renderOverview();
  await waitFor(() => expect(mockApi.listApplications).toHaveBeenCalled());

  // Mass-apply pulse panel exists with all four sub-blocks
  const right = await screen.findByTestId("overview-massapply");
  expect(right).toBeInTheDocument();

  // Counters render with derived values
  await screen.findByTestId("overview-counters");
  expect(screen.getByText("Posted today")).toBeInTheDocument();
  expect(screen.getByText("Needs you")).toBeInTheDocument();
  expect(screen.getByText("Submitted today")).toBeInTheDocument();

  // MaxGauge expanded — has the Max-window header label
  const gauge = screen.getByTestId("overview-gauge");
  expect(gauge.querySelector('[role="meter"]')).not.toBeNull();
  expect(gauge.querySelector('[role="meter"]')?.getAttribute("data-size")).toBe("expanded");

  // Inbox preview lists the postings
  expect(await screen.findByTestId("overview-posting-11")).toBeInTheDocument();
  expect(screen.getByTestId("overview-posting-12")).toBeInTheDocument();
  expect(screen.getAllByText("Senior Engineer").length).toBeGreaterThan(0);

  // Queue preview lists the applications
  expect(screen.getByTestId("overview-application-101")).toBeInTheDocument();
  expect(screen.getByTestId("overview-application-102")).toBeInTheDocument();
});

test("derives counters from the loaded data", async () => {
  renderOverview();
  const counters = await screen.findByTestId("overview-counters");
  // Posted today: 1 (only id=11 has today's ingested_at)
  // Needs you:   1 (id=101 is prepared)
  // Submitted today: 1 (id=102 submitted_at is today)
  // Each "1" appears in its own counter cell, so there are three "1"s total.
  const ones = counters.querySelectorAll(".mono");
  const values = Array.from(ones).map((n) => n.textContent);
  expect(values).toEqual(["1", "1", "1"]);
});

test("requests previews with limit params", async () => {
  renderOverview();
  await waitFor(() => expect(mockApi.listPostings).toHaveBeenCalled());
  expect(mockApi.listPostings).toHaveBeenCalledWith({ limit: 5 });
  expect(mockApi.listApplications).toHaveBeenCalledWith({ limit: 5 });
});

test("shows skeleton placeholders before data resolves", async () => {
  // Hold the promises open so loading state stays visible.
  let resolveResumes: (v: any) => void;
  mockApi.listResumes.mockImplementation(
    () => new Promise((res) => { resolveResumes = res; }),
  );
  let resolvePostings: (v: any) => void;
  mockApi.listPostings.mockImplementation(
    () => new Promise((res) => { resolvePostings = res; }),
  );
  let resolveApps: (v: any) => void;
  mockApi.listApplications.mockImplementation(
    () => new Promise((res) => { resolveApps = res; }),
  );

  renderOverview();

  // Skeletons present in each column.
  expect(screen.getByTestId("resumes-skeleton")).toBeInTheDocument();
  expect(screen.getByTestId("counters-skeleton")).toBeInTheDocument();
  expect(screen.getByTestId("inbox-skeleton")).toBeInTheDocument();
  expect(screen.getByTestId("queue-skeleton")).toBeInTheDocument();

  // Resolve everything to avoid leaking pending promises.
  resolveResumes!(sampleResumes);
  resolvePostings!({ items: samplePostings, total: 12 });
  resolveApps!({ items: sampleApps, total: 7 });
  await waitFor(() => expect(screen.queryByTestId("resumes-skeleton")).not.toBeInTheDocument());
});

test("shows inline error message when any API call rejects", async () => {
  mockApi.listPostings.mockRejectedValue(new Error("boom"));
  renderOverview();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/boom/i);
});

test("shows empty hints when lists are empty", async () => {
  mockApi.listResumes.mockResolvedValue([]);
  mockApi.listPostings.mockResolvedValue({ items: [], total: 0 });
  mockApi.listApplications.mockResolvedValue({ items: [], total: 0 });

  renderOverview();
  expect(await screen.findByText(/No resumes yet/i)).toBeInTheDocument();
  expect(screen.getByText(/No postings yet/i)).toBeInTheDocument();
  expect(screen.getByText(/Queue is empty/i)).toBeInTheDocument();
});

test("clicking a resume row navigates to its editor", async () => {
  const navigate = vi.fn();
  renderOverview(navigate);
  const row = await screen.findByTestId("overview-resume-1");
  fireEvent.click(row);
  expect(navigate).toHaveBeenCalledWith("/resumes/1");
});

test("'Open inbox' and 'Open queue' links navigate", async () => {
  const navigate = vi.fn();
  renderOverview(navigate);
  await screen.findByTestId("overview-inbox");
  fireEvent.click(screen.getByText(/Open inbox/));
  expect(navigate).toHaveBeenCalledWith("/inbox");
  fireEvent.click(screen.getByText(/Open queue/));
  expect(navigate).toHaveBeenCalledWith("/applications");
});
