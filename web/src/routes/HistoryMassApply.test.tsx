import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import HistoryMassApply, { buildSparkBuckets } from "./HistoryMassApply";
import { beforeEach, vi, test, expect, describe } from "vitest";

const mockApi = vi.hoisted(() => ({
  listApplications: vi.fn(),
}));

vi.mock("../api", () => ({ api: mockApi }));

function makePosting(over: Partial<any> = {}) {
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
    status: "submitted",
    ingested_at: "2026-04-20T12:00:00Z",
    ...over,
  };
}

function makeApp(over: Partial<any> = {}): any {
  return {
    id: over.id ?? 1,
    posting_id: over.posting_id ?? 100,
    posting: over.posting ?? makePosting({ id: 1 }),
    status: "submitted",
    mode: "B",
    cover_letter_text: null,
    form_payload: null,
    submitted_at: "2026-04-25T12:00:00Z",
    error: null,
    ...over,
  };
}

const sample = [
  makeApp({
    id: 1,
    posting: makePosting({ id: 1, company: "Acme Corp", title: "Senior Engineer" }),
    submitted_at: "2026-04-25T12:00:00Z",
    cover_letter_text: "Dear hiring team…",
    form_payload: { q1: "yes" },
  }),
  makeApp({
    id: 2,
    posting: makePosting({ id: 2, company: "Beta Labs", title: "Staff Engineer" }),
    submitted_at: "2026-04-24T09:30:00Z",
    cover_letter_text: null,
    form_payload: null,
  }),
  makeApp({
    id: 3,
    posting: makePosting({ id: 3, company: "Gamma Inc", title: "Platform Engineer" }),
    submitted_at: "2026-04-22T16:00:00Z",
    cover_letter_text: "Hello there…",
    form_payload: null,
  }),
];

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  mockApi.listApplications.mockResolvedValue({ items: sample, total: 3 });
});

function renderRoute() {
  return render(<HistoryMassApply />);
}

test("requests submitted applications with limit=200", async () => {
  renderRoute();
  await waitFor(() => expect(mockApi.listApplications).toHaveBeenCalled());
  expect(mockApi.listApplications).toHaveBeenCalledWith({
    status: "submitted",
    limit: 200,
  });
});

test("renders rows from mocked data with date/posting/tokens columns", async () => {
  renderRoute();
  await screen.findByText("Acme Corp");
  expect(screen.getByText("Senior Engineer")).toBeInTheDocument();
  expect(screen.getByText("Beta Labs")).toBeInTheDocument();
  expect(screen.getByText("Staff Engineer")).toBeInTheDocument();
  expect(screen.getByText("Gamma Inc")).toBeInTheDocument();
  expect(screen.getAllByTestId("history-row")).toHaveLength(3);
});

test("R/C/A ticks reflect inferred sent flags per row", async () => {
  renderRoute();
  await screen.findByText("Acme Corp");
  const rows = screen.getAllByTestId("history-row");

  // Row 1: R + C + A all sent.
  const r1 = within(rows[0]);
  expect(r1.getByTestId("sent-tick-r")).toHaveAttribute("data-sent", "true");
  expect(r1.getByTestId("sent-tick-c")).toHaveAttribute("data-sent", "true");
  expect(r1.getByTestId("sent-tick-a")).toHaveAttribute("data-sent", "true");

  // Row 2: only R (no cover, no answers).
  const r2 = within(rows[1]);
  expect(r2.getByTestId("sent-tick-r")).toHaveAttribute("data-sent", "true");
  expect(r2.getByTestId("sent-tick-c")).toHaveAttribute("data-sent", "false");
  expect(r2.getByTestId("sent-tick-a")).toHaveAttribute("data-sent", "false");

  // Row 3: R + C, no answers.
  const r3 = within(rows[2]);
  expect(r3.getByTestId("sent-tick-c")).toHaveAttribute("data-sent", "true");
  expect(r3.getByTestId("sent-tick-a")).toHaveAttribute("data-sent", "false");
});

test("sparkline header is visible with correct day count", async () => {
  renderRoute();
  await screen.findByText("Acme Corp");
  const strip = screen.getByTestId("history-massapply-strip");
  const spark = within(strip).getByRole("img");
  expect(spark).toHaveAttribute("data-points", "14");
});

test("renders a submitted status pill on each row", async () => {
  renderRoute();
  await screen.findByText("Acme Corp");
  const pills = screen.getAllByRole("status");
  // Each of the 3 rows contains a pill.
  expect(pills.length).toBeGreaterThanOrEqual(3);
  expect(pills[0]).toHaveAttribute("data-status", "submitted");
});

test("shows tokens / duration em-dash when backend omits the fields", async () => {
  renderRoute();
  await screen.findByText("Acme Corp");
  // sample data has neither tokens_used nor duration_ms → all rows show "—".
  expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
});

test("loading state renders before data resolves", async () => {
  let resolve!: (v: { items: any[]; total: number }) => void;
  mockApi.listApplications.mockReturnValue(
    new Promise((res) => {
      resolve = res;
    }),
  );
  renderRoute();
  expect(screen.getByTestId("history-loading")).toBeInTheDocument();
  resolve({ items: sample, total: 3 });
  await screen.findByText("Acme Corp");
});

test("empty state when API returns []", async () => {
  mockApi.listApplications.mockResolvedValue({ items: [], total: 0 });
  renderRoute();
  expect(await screen.findByTestId("history-empty")).toBeInTheDocument();
  expect(screen.queryByTestId("history-table")).not.toBeInTheDocument();
});

test("Load more appears when total > items.length and refetches with offset", async () => {
  mockApi.listApplications.mockResolvedValueOnce({ items: sample, total: 5 });
  renderRoute();
  await screen.findByText("Acme Corp");
  const more = await screen.findByTestId("history-load-more");
  expect(more).toBeInTheDocument();

  const extra = [
    makeApp({
      id: 4,
      posting: makePosting({ id: 4, company: "Delta Co", title: "SWE" }),
      submitted_at: "2026-04-21T10:00:00Z",
    }),
    makeApp({
      id: 5,
      posting: makePosting({ id: 5, company: "Epsilon", title: "SRE" }),
      submitted_at: "2026-04-20T10:00:00Z",
    }),
  ];
  mockApi.listApplications.mockResolvedValueOnce({ items: extra, total: 5 });
  fireEvent.click(more);
  await screen.findByText("Delta Co");

  expect(mockApi.listApplications).toHaveBeenLastCalledWith({
    status: "submitted",
    limit: 200,
    offset: 3,
  });
  // No more "Load more" once we've caught up to total.
  expect(screen.queryByTestId("history-load-more")).not.toBeInTheDocument();
});

describe("buildSparkBuckets", () => {
  test("returns an array of length `days`", () => {
    const out = buildSparkBuckets([], 14);
    expect(out).toHaveLength(14);
    expect(out.every((n) => n === 0)).toBe(true);
  });

  test("today's submissions land in the last bucket", () => {
    const now = new Date(2026, 3, 25, 14, 0, 0); // local-time
    const apps = [{ submitted_at: new Date(2026, 3, 25, 9, 0, 0).toISOString() }];
    const out = buildSparkBuckets(apps, 14, now);
    expect(out[13]).toBe(1);
    expect(out.slice(0, 13).every((n) => n === 0)).toBe(true);
  });

  test("submissions older than the window are dropped", () => {
    const now = new Date(2026, 3, 25);
    const apps = [{ submitted_at: new Date(2026, 0, 1).toISOString() }];
    const out = buildSparkBuckets(apps, 14, now);
    expect(out.every((n) => n === 0)).toBe(true);
  });
});
