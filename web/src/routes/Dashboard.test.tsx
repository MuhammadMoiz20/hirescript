import { render, screen, waitFor, within } from "@testing-library/react";
import Dashboard, {
  buildAppliedSparkBuckets,
  buildActivityFeed,
} from "./Dashboard";
import { beforeEach, vi, test, expect, describe } from "vitest";

const mockApi = vi.hoisted(() => ({
  listPostings: vi.fn(),
  listApplications: vi.fn(),
}));
const mockListJobs = vi.hoisted(() => vi.fn());

vi.mock("../api", () => ({
  api: mockApi,
  listJobs: mockListJobs,
}));

function makePosting(over: Partial<any> = {}): any {
  return {
    id: 100 + (over.id ?? 0),
    source: "greenhouse",
    source_job_id: `g-${over.id ?? 0}`,
    company: "Acme Corp",
    title: "Senior Engineer",
    location: "Remote",
    apply_url: "https://example.com/apply",
    tier: "dream",
    fit_score: 88,
    status: "ingested",
    ingested_at: "2026-04-25T12:00:00Z",
    ...over,
  };
}

function makeApp(over: Partial<any> = {}): any {
  return {
    id: over.id ?? 1,
    posting_id: over.posting_id ?? 100,
    posting: over.posting ?? makePosting({ id: over.id ?? 1 }),
    status: "submitted",
    mode: "B",
    cover_letter_text: null,
    form_payload: null,
    submitted_at: "2026-04-25T12:00:00Z",
    error: null,
    ...over,
  };
}

function makeJob(over: Partial<any> = {}): any {
  return {
    id: `job-${over.id ?? "x"}`,
    kind: "tailor",
    status: "succeeded",
    batch_id: null,
    payload: {},
    result: null,
    attempts: 1,
    created_at: "2026-04-25T11:00:00Z",
    started_at: "2026-04-25T11:00:01Z",
    finished_at: "2026-04-25T11:00:30Z",
    ...over,
  };
}

const samplePostings = [
  makePosting({ id: 1, title: "Backend Engineer" }),
  makePosting({ id: 2, title: "Platform Engineer", company: "Beta Labs" }),
];

const sampleApps = [
  makeApp({ id: 1, submitted_at: "2026-04-25T12:00:00Z" }),
  makeApp({ id: 2, submitted_at: "2026-04-24T12:00:00Z" }),
  makeApp({
    id: 3,
    status: "stuck",
    submitted_at: null,
    error: "Captcha required",
    posting: makePosting({ id: 3, company: "Stuck Co", title: "DevOps" }),
  }),
  makeApp({
    id: 4,
    status: "errored",
    submitted_at: null,
    error: "Form mapping failed",
    posting: makePosting({ id: 4, company: "Err Inc", title: "SRE" }),
  }),
  makeApp({
    id: 5,
    status: "prepared",
    submitted_at: null,
    posting: makePosting({ id: 5, company: "Prep Inc", title: "ML" }),
  }),
];

const sampleJobs = [
  makeJob({ id: "a" }),
  makeJob({ id: "b", finished_at: "2026-04-25T13:00:00Z" }),
];

beforeEach(() => {
  mockApi.listPostings.mockReset();
  mockApi.listApplications.mockReset();
  mockListJobs.mockReset();
  mockApi.listPostings.mockResolvedValue({ items: samplePostings, total: samplePostings.length });
  mockApi.listApplications.mockResolvedValue({ items: sampleApps, total: sampleApps.length });
  mockListJobs.mockResolvedValue({ items: sampleJobs, total: sampleJobs.length });
});

function renderRoute() {
  return render(<Dashboard />);
}

test("renders all four KPI tiles", async () => {
  renderRoute();
  await waitFor(() => expect(mockApi.listApplications).toHaveBeenCalled());
  expect(screen.getByTestId("kpi-applied")).toBeInTheDocument();
  expect(screen.getByTestId("kpi-queue")).toBeInTheDocument();
  expect(screen.getByTestId("kpi-needs-you")).toBeInTheDocument();
  expect(screen.getByTestId("kpi-max-window")).toBeInTheDocument();
});

test("renders the 14-day applied sparkline", async () => {
  renderRoute();
  await waitFor(() => expect(mockApi.listApplications).toHaveBeenCalled());
  const sparkWrap = await screen.findByTestId("kpi-applied-spark");
  const svg = within(sparkWrap).getByRole("img");
  expect(svg).toHaveAttribute("data-points", "14");
});

test("page header shows title and eyebrow", async () => {
  renderRoute();
  expect(screen.getByText(/Today, at a glance/i)).toBeInTheDocument();
});

test("queue tile shows the in-flight count (excludes submitted/cancelled)", async () => {
  renderRoute();
  await waitFor(() => expect(mockApi.listApplications).toHaveBeenCalled());
  // 3 in-flight: stuck(3), errored(4), prepared(5). Submitted ones (1,2) excluded.
  const queue = await screen.findByTestId("kpi-queue");
  expect(within(queue).getByText("3")).toBeInTheDocument();
});

test("needs-you tile counts stuck + errored", async () => {
  renderRoute();
  const needs = await screen.findByTestId("kpi-needs-you");
  await waitFor(() => expect(within(needs).queryByText("2")).toBeInTheDocument());
});

test("renders tier-cap bars for dream/targeted/wide", async () => {
  renderRoute();
  await waitFor(() => expect(screen.getByTestId("dashboard-tier-caps")).toBeInTheDocument());
  expect(screen.getByTestId("cap-bar-dream")).toBeInTheDocument();
  expect(screen.getByTestId("cap-bar-targeted")).toBeInTheDocument();
  expect(screen.getByTestId("cap-bar-wide")).toBeInTheDocument();
});

test("renders mode-mix donut with data attributes", async () => {
  renderRoute();
  const donut = await screen.findByTestId("mode-mix-donut");
  // sample has 5 B-mode, 0 A-mode.
  expect(donut).toHaveAttribute("data-mode-a", "0");
  expect(donut).toHaveAttribute("data-mode-b", "5");
});

test("needs-you queue lists at most 3 stuck/errored applications", async () => {
  renderRoute();
  const section = await screen.findByTestId("dashboard-needs-you");
  await waitFor(() => {
    expect(within(section).getByTestId("needs-you-row-3")).toBeInTheDocument();
  });
  expect(within(section).getByTestId("needs-you-row-4")).toBeInTheDocument();
  // Only 2 needs-you in sample, so no overflow.
  expect(within(section).queryByTestId("needs-you-row-5")).not.toBeInTheDocument();
});

test("activity feed renders rows derived from postings/apps/jobs", async () => {
  renderRoute();
  const feed = await screen.findByTestId("dashboard-activity");
  await waitFor(() => expect(within(feed).getByTestId("activity-list")).toBeInTheDocument());
  const rows = within(feed).getAllByTestId(/^activity-row-/);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThanOrEqual(11);
});

test("renders empty needs-you hint when no blockers", async () => {
  mockApi.listApplications.mockResolvedValue({
    items: [makeApp({ id: 9, submitted_at: "2026-04-25T12:00:00Z" })],
    total: 1,
  });
  renderRoute();
  await waitFor(() =>
    expect(screen.getByTestId("needs-you-empty")).toBeInTheDocument(),
  );
});

test("surfaces an error banner when fetching fails", async () => {
  mockApi.listPostings.mockRejectedValue(new Error("boom"));
  renderRoute();
  await waitFor(() => expect(screen.getByTestId("dashboard-error")).toBeInTheDocument());
});

describe("buildAppliedSparkBuckets", () => {
  test("buckets a submission into the today slot", () => {
    const now = new Date("2026-04-25T18:00:00Z");
    const out = buildAppliedSparkBuckets(
      [{ submitted_at: now.toISOString() }],
      14,
      now,
    );
    expect(out).toHaveLength(14);
    expect(out[13]).toBe(1);
  });

  test("ignores items without submitted_at", () => {
    const out = buildAppliedSparkBuckets([{ submitted_at: null }], 14);
    expect(out.reduce((s, n) => s + n, 0)).toBe(0);
  });
});

describe("buildActivityFeed", () => {
  test("sorts events by timestamp desc and caps at limit", () => {
    const out = buildActivityFeed(
      samplePostings,
      sampleApps,
      sampleJobs,
      11,
    );
    expect(out.length).toBeGreaterThan(0);
    for (let i = 1; i < out.length; i++) {
      expect(new Date(out[i - 1].at).getTime()).toBeGreaterThanOrEqual(
        new Date(out[i].at).getTime(),
      );
    }
  });
});
