import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Inbox from "./Inbox";
import { beforeEach, vi, test, expect } from "vitest";

const mockApi = vi.hoisted(() => ({
  listPostings: vi.fn(),
  getPosting: vi.fn(),
  preparePosting: vi.fn(),
  skipPosting: vi.fn(),
}));

vi.mock("../api", () => ({ api: mockApi }));

const samplePostings = [
  {
    id: 1,
    source: "greenhouse",
    source_job_id: "g-1",
    company: "Acme Corp",
    title: "Senior Engineer",
    location: "Remote",
    apply_url: "https://example.com/apply/1",
    tier: "dream",
    fit_score: 88,
    status: "classified",
    ingested_at: "2026-04-25T12:00:00Z",
  },
  {
    id: 2,
    source: "greenhouse",
    source_job_id: "g-2",
    company: "Beta Labs",
    title: "Staff Engineer",
    location: "NYC",
    apply_url: "https://example.com/apply/2",
    tier: "targeted",
    fit_score: 65,
    status: "classified",
    ingested_at: "2026-04-24T12:00:00Z",
  },
];

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  mockApi.listPostings.mockResolvedValue({ items: samplePostings, total: 2 });
  mockApi.getPosting.mockResolvedValue({
    ...samplePostings[0],
    description_text: "Full description here.",
    description_html: null,
    meta: {},
    canonical_key: "acme-senior-engineer",
    classification_rationale: "Matches role family.",
  });
});

function renderInbox(navigate?: (p: string) => void) {
  return render(
    <MemoryRouter>
      <Inbox navigateOverride={navigate} />
    </MemoryRouter>,
  );
}

test("renders postings from listPostings", async () => {
  renderInbox();
  await waitFor(() => expect(mockApi.listPostings).toHaveBeenCalled());
  expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
  expect(screen.getByText(/Senior Engineer/)).toBeInTheDocument();
  expect(screen.getByText("Beta Labs")).toBeInTheDocument();
  expect(screen.getByText(/Staff Engineer/)).toBeInTheDocument();
});

test("filters by tier via chip", async () => {
  renderInbox();
  await waitFor(() => expect(mockApi.listPostings).toHaveBeenCalledTimes(1));

  const tierGroup = screen.getByRole("group", { name: /tier filter/i });
  fireEvent.click(within(tierGroup).getByRole("button", { name: "Dream" }));

  await waitFor(() => expect(mockApi.listPostings).toHaveBeenCalledTimes(2));
  const lastCall = mockApi.listPostings.mock.calls[mockApi.listPostings.mock.calls.length - 1][0];
  expect(lastCall).toMatchObject({ tier: "dream" });
});

test("clicking 'Prepare' calls preparePosting and navigates", async () => {
  mockApi.preparePosting.mockResolvedValue({ job_id: "job-uuid", batch_id: "batch-uuid" });
  const navigate = vi.fn();
  renderInbox(navigate);
  await screen.findByText("Acme Corp");

  const prepareButtons = screen.getAllByTestId("posting-prepare-btn");
  fireEvent.click(prepareButtons[0]);

  await waitFor(() => expect(mockApi.preparePosting).toHaveBeenCalledWith(1));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/jobs?batch=batch-uuid"));
});

test("shows empty state when no postings", async () => {
  mockApi.listPostings.mockResolvedValue({ items: [], total: 0 });
  renderInbox();
  await waitFor(() => expect(mockApi.listPostings).toHaveBeenCalled());
  expect(await screen.findByText(/no postings yet/i)).toBeInTheDocument();
});

test("clicking a row opens the detail drawer", async () => {
  renderInbox();
  await screen.findByText("Acme Corp");
  fireEvent.click(screen.getByText("Acme Corp"));
  await waitFor(() => expect(mockApi.getPosting).toHaveBeenCalledWith(1));
  expect(await screen.findByText("Full description here.")).toBeInTheDocument();
});

test("drawer renders the 4-stage pipeline trace with correct stage states", async () => {
  // Use a posting in 'preparing' so we exercise done/current/queued at once.
  mockApi.getPosting.mockResolvedValue({
    ...samplePostings[0],
    status: "preparing",
    description_text: "Desc.",
    description_html: null,
    meta: {},
    canonical_key: "acme-senior-engineer",
    classification_rationale: "Strong match on role family.",
  });

  renderInbox();
  await screen.findByText("Acme Corp");
  fireEvent.click(screen.getByText("Acme Corp"));

  const trace = await screen.findByTestId("pipeline-trace");
  const stages = within(trace).getAllByRole("listitem");
  expect(stages).toHaveLength(4);

  // Verify the four expected stages, in order, with their states.
  expect(stages[0]).toHaveAttribute("data-stage", "ingest");
  expect(stages[0]).toHaveAttribute("data-state", "done");

  expect(stages[1]).toHaveAttribute("data-stage", "classify");
  expect(stages[1]).toHaveAttribute("data-state", "done");

  expect(stages[2]).toHaveAttribute("data-stage", "tailor");
  expect(stages[2]).toHaveAttribute("data-state", "current");

  expect(stages[3]).toHaveAttribute("data-stage", "submit");
  expect(stages[3]).toHaveAttribute("data-state", "queued");

  // Labels are rendered.
  expect(within(trace).getByText("Ingest")).toBeInTheDocument();
  expect(within(trace).getByText("Classify")).toBeInTheDocument();
  expect(within(trace).getByText("Tailor")).toBeInTheDocument();
  expect(within(trace).getByText("Submit")).toBeInTheDocument();

  // Classifier reasoning is shown alongside.
  expect(screen.getByText("Strong match on role family.")).toBeInTheDocument();
});

test("status chip filters client-side without an extra fetch", async () => {
  renderInbox();
  await screen.findByText("Acme Corp");
  expect(mockApi.listPostings).toHaveBeenCalledTimes(1);

  const statusGroup = screen.getByRole("group", { name: /status filter/i });
  fireEvent.click(within(statusGroup).getByRole("button", { name: /needs you/i }));

  // Both sample postings are 'classified' which falls under 'needs you'
  // in our chip mapping, so no extra fetch and both still render.
  expect(mockApi.listPostings).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  expect(screen.getByText("Beta Labs")).toBeInTheDocument();

  // Switching to 'Submitted' should hide both (neither is submitted).
  fireEvent.click(within(statusGroup).getByRole("button", { name: /submitted/i }));
  expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
  expect(screen.getByText(/no postings match/i)).toBeInTheDocument();
});

test("toggling a sortable header reverses the row order", async () => {
  renderInbox();
  await screen.findByText("Acme Corp");

  // Default: ingested desc → Acme (newer) before Beta.
  let rows = screen.getAllByTestId("posting-row");
  expect(rows[0]).toHaveAttribute("data-posting-id", "1");
  expect(rows[1]).toHaveAttribute("data-posting-id", "2");

  // Click 'Company / Role' twice to apply asc then desc; once is asc.
  fireEvent.click(screen.getByRole("button", { name: /company \/ role/i }));
  rows = screen.getAllByTestId("posting-row");
  expect(rows[0]).toHaveAttribute("data-posting-id", "1"); // Acme < Beta asc
  expect(rows[1]).toHaveAttribute("data-posting-id", "2");

  fireEvent.click(screen.getByRole("button", { name: /company \/ role/i }));
  rows = screen.getAllByTestId("posting-row");
  expect(rows[0]).toHaveAttribute("data-posting-id", "2"); // desc → Beta first
  expect(rows[1]).toHaveAttribute("data-posting-id", "1");
});
