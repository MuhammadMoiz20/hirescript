import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
  expect(screen.getByText("Senior Engineer")).toBeInTheDocument();
  expect(screen.getByText("Beta Labs")).toBeInTheDocument();
  expect(screen.getByText("Staff Engineer")).toBeInTheDocument();
});

test("filters by tier", async () => {
  renderInbox();
  await waitFor(() => expect(mockApi.listPostings).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole("button", { name: "Dream" }));

  await waitFor(() => expect(mockApi.listPostings).toHaveBeenCalledTimes(2));
  const lastCall = mockApi.listPostings.mock.calls[mockApi.listPostings.mock.calls.length - 1][0];
  expect(lastCall).toMatchObject({ tier: "dream" });
});

test("clicking 'Prepare application' calls preparePosting and navigates", async () => {
  mockApi.preparePosting.mockResolvedValue({ job_id: "job-uuid", batch_id: "batch-uuid" });
  const navigate = vi.fn();
  renderInbox(navigate);
  await screen.findByText("Acme Corp");

  // The row is also role="button" and contains the prepare label, so getAllByRole
  // returns both; click the actual <button> element (last match).
  const prepareCandidates = screen.getAllByRole("button", { name: /prepare application/i });
  const prepareButton = prepareCandidates.find((el) => el.tagName === "BUTTON")!;
  fireEvent.click(prepareButton);

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
