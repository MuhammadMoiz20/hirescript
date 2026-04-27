import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, vi, test, expect } from "vitest";
import PasteUrlDialog from "./PasteUrlDialog";

const mockApi = vi.hoisted(() => ({
  pasteJobUrl: vi.fn(),
}));

vi.mock("../api", () => ({ api: mockApi }));

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
});

const sample = {
  id: 42,
  source: "lever",
  source_job_id: "abc",
  company: "Netflix",
  title: "Senior SWE",
  location: "Remote",
  apply_url: "https://jobs.lever.co/netflix/abc",
  tier: null,
  fit_score: null,
  status: "ingested",
  ingested_at: "2026-04-27T00:00:00Z",
};

test("opens with focus on the URL input", async () => {
  render(<PasteUrlDialog open onClose={() => {}} onCreated={() => {}} />);
  const input = await screen.findByTestId("paste-url-input");
  await waitFor(() => expect(document.activeElement).toBe(input));
});

test("happy path: submit calls pasteJobUrl and onCreated", async () => {
  mockApi.pasteJobUrl.mockResolvedValue(sample);
  const onCreated = vi.fn();
  render(<PasteUrlDialog open onClose={() => {}} onCreated={onCreated} />);

  fireEvent.change(screen.getByTestId("paste-url-input"), {
    target: { value: "https://jobs.lever.co/netflix/abc" },
  });
  fireEvent.click(screen.getByTestId("paste-url-submit"));

  await waitFor(() =>
    expect(mockApi.pasteJobUrl).toHaveBeenCalledWith(
      "https://jobs.lever.co/netflix/abc",
    ),
  );
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(sample));
});

test("422 response shows the detail inline", async () => {
  mockApi.pasteJobUrl.mockRejectedValue({
    status: 422,
    detail: "URL not recognized",
  });
  render(<PasteUrlDialog open onClose={() => {}} onCreated={() => {}} />);

  fireEvent.change(screen.getByTestId("paste-url-input"), {
    target: { value: "https://example.com/job/1" },
  });
  fireEvent.click(screen.getByTestId("paste-url-submit"));

  expect(await screen.findByTestId("paste-url-error")).toHaveTextContent(
    /not recognized/i,
  );
});

test("cancel closes without firing the API", async () => {
  const onClose = vi.fn();
  render(<PasteUrlDialog open onClose={onClose} onCreated={() => {}} />);
  fireEvent.click(screen.getByTestId("paste-url-cancel"));
  expect(onClose).toHaveBeenCalled();
  expect(mockApi.pasteJobUrl).not.toHaveBeenCalled();
});
