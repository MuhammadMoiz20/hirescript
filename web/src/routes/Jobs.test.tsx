import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, test, expect, beforeEach } from "vitest";
import { Jobs } from "./Jobs";

vi.mock("../api", () => ({
  listJobs: vi.fn(),
  cancelJob: vi.fn().mockResolvedValue(undefined),
  enqueueTailorBatch: vi.fn().mockResolvedValue({ batch_id: "b2", job_ids: ["c"] }),
}));

const sampleItems = [
  {
    id: "a",
    status: "running",
    batch_id: "b1",
    payload: { title: "SWE", company: "Acme", resume_id: 1, jd_text: "JD A" },
    result: null,
    created_at: "2026-04-25T00:00:00Z",
    started_at: "2026-04-25T00:00:01Z",
    finished_at: null,
    attempts: 1,
    kind: "tailor",
  },
  {
    id: "b",
    status: "failed",
    batch_id: "b1",
    payload: { title: "SWE", company: "Beta", resume_id: 1, jd_text: "JD B" },
    result: { error: "boom" },
    created_at: "2026-04-25T00:00:00Z",
    started_at: "2026-04-25T00:00:01Z",
    finished_at: "2026-04-25T00:00:30Z",
    attempts: 1,
    kind: "tailor",
  },
];

beforeEach(async () => {
  const { listJobs, cancelJob, enqueueTailorBatch } = await import("../api");
  (listJobs as any).mockReset();
  (listJobs as any).mockResolvedValue({ items: sampleItems, total: 2 });
  (cancelJob as any).mockReset();
  (cancelJob as any).mockResolvedValue(undefined);
  (enqueueTailorBatch as any).mockReset();
  (enqueueTailorBatch as any).mockResolvedValue({ batch_id: "b2", job_ids: ["c"] });
});

test("renders jobs grouped by batch", async () => {
  render(
    <MemoryRouter>
      <Jobs />
    </MemoryRouter>,
  );
  await waitFor(() => screen.getByText("Acme"));
  expect(screen.getByText("Beta")).toBeInTheDocument();
  expect(screen.getByText(/boom/)).toBeInTheDocument();
});

test("shows status pills", async () => {
  render(
    <MemoryRouter>
      <Jobs />
    </MemoryRouter>,
  );
  await waitFor(() => screen.getByText("Acme"));
  expect(screen.getByText("running")).toBeInTheDocument();
  expect(screen.getByText("failed")).toBeInTheDocument();
});

test("cancel button on running job calls cancelJob", async () => {
  const { cancelJob } = await import("../api");
  render(
    <MemoryRouter>
      <Jobs />
    </MemoryRouter>,
  );
  await waitFor(() => screen.getByText("Acme"));
  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  await waitFor(() => expect(cancelJob).toHaveBeenCalledWith("a"));
});

test("retry button on failed job calls enqueueTailorBatch", async () => {
  const { enqueueTailorBatch } = await import("../api");
  render(
    <MemoryRouter>
      <Jobs />
    </MemoryRouter>,
  );
  await waitFor(() => screen.getByText("Beta"));
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await waitFor(() => expect(enqueueTailorBatch).toHaveBeenCalled());
  const call = (enqueueTailorBatch as any).mock.calls[0][0];
  expect(call.resume_id).toBe(1);
  expect(call.items[0].title).toBe("SWE");
  expect(call.items[0].company).toBe("Beta");
});
