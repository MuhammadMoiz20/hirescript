import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Knowledge from "./Knowledge";
import { afterEach, beforeEach, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getKbSources: vi.fn(),
  syncKbSource: vi.fn(),
  getKbDocuments: vi.fn(),
  deleteKbDocument: vi.fn(),
  getProfile: vi.fn(),
  putProfile: vi.fn(),
}));

vi.mock("../api", () => ({ api: mockApi }));

const baseProfile = {
  legal_name: "Existing",
  preferred_name: null,
  email: "user@example.com",
  phone: null,
  address: null,
  links: {},
  work_auth: { citizenships: [], sponsorship_needed: {}, relocate_to: [] },
  positions: [],
  education: [],
  languages: [],
  preferences: {
    salary_floor_usd: null,
    salary_target_usd: null,
    role_families: [],
    dealbreakers: [],
    company_stages: [],
    work_modes: [],
    cover_letter_default: true,
    disclose_salary_default: false,
  },
  eeo: { gender: null, race_ethnicity: null, veteran: null, disability: null },
  kill_list: [],
};

function resetLocation() {
  // Reset the test URL between cases so deep-link / replaceState side effects
  // from one test don't leak into the next.
  window.history.replaceState({}, "", "/");
}

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
  mockApi.getProfile.mockResolvedValue({ ...baseProfile });
  resetLocation();
});

afterEach(() => {
  resetLocation();
});

test("renders source cards with counts on the Sources tab", async () => {
  render(<Knowledge tab="sources" />);
  await waitFor(() => expect(screen.getByRole("heading", { name: /master latex/i })).toBeInTheDocument());
  expect(screen.getByRole("heading", { name: /manual markdown/i })).toBeInTheDocument();
  const latex = screen.getByRole("heading", { name: /master latex/i }).closest("div")!.parentElement!;
  expect(latex.textContent).toMatch(/1\s*docs/);
  expect(latex.textContent).toMatch(/8\s*chunks/);
});

test("clicking 'Sync now' calls syncKbSource and refreshes counts", async () => {
  mockApi.syncKbSource.mockResolvedValue({
    source: "markdown", document_count: 4, chunk_count: 27, created_or_updated: 1, deleted: 0,
  });
  mockApi.getKbSources
    .mockResolvedValueOnce([
      { source: "latex_master", document_count: 1, chunk_count: 8, last_synced_at: "2026-04-26T12:00:00Z" },
      { source: "markdown", document_count: 3, chunk_count: 21, last_synced_at: null },
    ])
    .mockResolvedValue([
      { source: "latex_master", document_count: 1, chunk_count: 8, last_synced_at: "2026-04-26T12:00:00Z" },
      { source: "markdown", document_count: 4, chunk_count: 27, last_synced_at: "2026-04-26T13:00:00Z" },
    ]);

  render(<Knowledge tab="sources" />);
  await waitFor(() => expect(screen.getByText(/manual markdown/i)).toBeInTheDocument());
  const syncButtons = screen.getAllByRole("button", { name: /sync now/i });
  fireEvent.click(syncButtons[1]);
  await waitFor(() => expect(mockApi.syncKbSource).toHaveBeenCalledWith("markdown"));
  await waitFor(() => expect(screen.getByText("27")).toBeInTheDocument());
});

test("deleting a document removes it from the list on the Documents tab", async () => {
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

  render(<Knowledge tab="documents" />);
  await waitFor(() => expect(screen.getByText("Note A")).toBeInTheDocument());
  const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
  fireEvent.click(deleteButtons[0]);
  await waitFor(() => expect(mockApi.deleteKbDocument).toHaveBeenCalledWith(11));
  await waitFor(() => expect(screen.queryByText("Note A")).not.toBeInTheDocument());
  expect(screen.getByText("Note B")).toBeInTheDocument();
});

test("defaults to the Profile tab and renders profile fields", async () => {
  render(<Knowledge />);
  await waitFor(() => expect(screen.getByDisplayValue("Existing")).toBeInTheDocument());
  expect(screen.getByDisplayValue("user@example.com")).toBeInTheDocument();
  // Profile tab is selected.
  expect(screen.getByTestId("knowledge-tab-profile")).toHaveAttribute("aria-selected", "true");
});

test("clicking a tab switches the rendered panel and updates the URL", async () => {
  render(<Knowledge />);
  await waitFor(() => expect(screen.getByDisplayValue("Existing")).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("knowledge-tab-sources"));
  await waitFor(() => expect(screen.getByRole("heading", { name: /master latex/i })).toBeInTheDocument());
  expect(screen.getByTestId("knowledge-tab-sources")).toHaveAttribute("aria-selected", "true");
  expect(window.location.search).toContain("tab=sources");

  fireEvent.click(screen.getByTestId("knowledge-tab-documents"));
  await waitFor(() => expect(screen.getByText("Note A")).toBeInTheDocument());
  expect(window.location.search).toContain("tab=documents");
});

test("deep-link via ?tab=documents selects Documents on mount", async () => {
  window.history.replaceState({}, "", "/?tab=documents");
  render(<Knowledge />);
  await waitFor(() => expect(screen.getByText("Note A")).toBeInTheDocument());
  expect(screen.getByTestId("knowledge-tab-documents")).toHaveAttribute("aria-selected", "true");
});

test("deep-link via ?tab=sources selects Sources on mount", async () => {
  window.history.replaceState({}, "", "/?tab=sources");
  render(<Knowledge />);
  await waitFor(() => expect(screen.getByRole("heading", { name: /master latex/i })).toBeInTheDocument());
  expect(screen.getByTestId("knowledge-tab-sources")).toHaveAttribute("aria-selected", "true");
});

test("deep-link via ?tab=profile selects Profile on mount", async () => {
  window.history.replaceState({}, "", "/?tab=profile");
  render(<Knowledge />);
  await waitFor(() => expect(screen.getByDisplayValue("Existing")).toBeInTheDocument());
  expect(screen.getByTestId("knowledge-tab-profile")).toHaveAttribute("aria-selected", "true");
});

test("Sources tab shows the Job-source families empty state", async () => {
  render(<Knowledge tab="sources" />);
  await waitFor(() => expect(screen.getByTestId("job-source-families-empty")).toBeInTheDocument());
  expect(screen.getByTestId("job-source-families-empty").textContent).toMatch(/Slice 4/);
});
