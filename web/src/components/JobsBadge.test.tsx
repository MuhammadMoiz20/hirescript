import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, test, expect } from "vitest";
import { JobsBadge } from "./JobsBadge";

vi.mock("../api", () => ({
  listJobs: vi.fn().mockResolvedValue({ items: [], total: 3 }),
}));

test("shows count when > 0", async () => {
  render(
    <MemoryRouter>
      <JobsBadge />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
});

test("hidden at 0", async () => {
  const { listJobs } = await import("../api");
  (listJobs as any).mockResolvedValue({ items: [], total: 0 });
  render(
    <MemoryRouter>
      <JobsBadge />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByTestId("jobs-badge")).toBeNull());
});
