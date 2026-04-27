import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Knowledge from "./Knowledge";
import { beforeEach, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getKbSources: vi.fn(),
  syncKbSource: vi.fn(),
  getKbDocuments: vi.fn(),
  deleteKbDocument: vi.fn(),
}));

vi.mock("../api", () => ({ api: mockApi }));

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  mockApi.getKbSources.mockResolvedValue([
    { source: "latex_master", document_count: 1, chunk_count: 8, last_synced_at: "2026-04-26T12:00:00Z" },
    { source: "markdown", document_count: 3, chunk_count: 21, last_synced_at: null },
  ]);
  mockApi.getKbDocuments.mockResolvedValue({
    items: [
      {
        id: 11, source: "markdown", source_id: "notes/a.md", title: "Note A",
        fetched_at: "2026-04-26T12:00:00Z", chunk_count: 4, hash: "h1",
      },
      {
        id: 12, source: "markdown", source_id: "notes/b.md", title: "Note B",
        fetched_at: "2026-04-25T12:00:00Z", chunk_count: 5, hash: "h2",
      },
    ],
    total: 2,
  });
});

test("renders source cards with counts", async () => {
  render(<Knowledge />);
  await waitFor(() => expect(screen.getByRole("heading", { name: /master latex/i })).toBeInTheDocument());
  expect(screen.getByRole("heading", { name: /manual markdown/i })).toBeInTheDocument();
  // Counts show up — find the latex_master card and assert its document/chunk counts.
  const latex = screen.getByRole("heading", { name: /master latex/i }).closest("div")!.parentElement!;
  expect(latex.textContent).toMatch(/1\s*docs/);
  expect(latex.textContent).toMatch(/8\s*chunks/);
});

test("clicking 'Sync now' calls syncKbSource and refreshes counts", async () => {
  mockApi.syncKbSource.mockResolvedValue({
    source: "markdown", document_count: 4, chunk_count: 27, created_or_updated: 1, deleted: 0,
  });
  // After sync, getKbSources returns updated counts.
  mockApi.getKbSources
    .mockResolvedValueOnce([
      { source: "latex_master", document_count: 1, chunk_count: 8, last_synced_at: "2026-04-26T12:00:00Z" },
      { source: "markdown", document_count: 3, chunk_count: 21, last_synced_at: null },
    ])
    .mockResolvedValue([
      { source: "latex_master", document_count: 1, chunk_count: 8, last_synced_at: "2026-04-26T12:00:00Z" },
      { source: "markdown", document_count: 4, chunk_count: 27, last_synced_at: "2026-04-26T13:00:00Z" },
    ]);

  render(<Knowledge />);
  await waitFor(() => expect(screen.getByText(/manual markdown/i)).toBeInTheDocument());
  const syncButtons = screen.getAllByRole("button", { name: /sync now/i });
  // The markdown card is second; sync it.
  fireEvent.click(syncButtons[1]);
  await waitFor(() => expect(mockApi.syncKbSource).toHaveBeenCalledWith("markdown"));
  await waitFor(() => expect(screen.getByText("27")).toBeInTheDocument());
});

test("deleting a document removes it from the list", async () => {
  mockApi.deleteKbDocument.mockResolvedValue(undefined);
  mockApi.getKbDocuments
    .mockResolvedValueOnce({
      items: [
        { id: 11, source: "markdown", source_id: "notes/a.md", title: "Note A", fetched_at: "2026-04-26T12:00:00Z", chunk_count: 4, hash: "h1" },
        { id: 12, source: "markdown", source_id: "notes/b.md", title: "Note B", fetched_at: "2026-04-25T12:00:00Z", chunk_count: 5, hash: "h2" },
      ],
      total: 2,
    })
    .mockResolvedValue({
      items: [
        { id: 12, source: "markdown", source_id: "notes/b.md", title: "Note B", fetched_at: "2026-04-25T12:00:00Z", chunk_count: 5, hash: "h2" },
      ],
      total: 1,
    });

  render(<Knowledge />);
  await waitFor(() => expect(screen.getByText("Note A")).toBeInTheDocument());
  const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
  fireEvent.click(deleteButtons[0]);
  await waitFor(() => expect(mockApi.deleteKbDocument).toHaveBeenCalledWith(11));
  await waitFor(() => expect(screen.queryByText("Note A")).not.toBeInTheDocument());
  expect(screen.getByText("Note B")).toBeInTheDocument();
});
