import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ResumeList from "./ResumeList";
import { beforeEach, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  listGroupedResumes: vi.fn(),
  createResume: vi.fn(),
  renameResume: vi.fn(),
  deleteResume: vi.fn(),
  duplicateResume: vi.fn(),
  downloadResumePdf: vi.fn(),
  getJd: vi.fn(),
}));

vi.mock("../api", () => ({ api: mockApi }));

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  mockApi.listGroupedResumes.mockResolvedValue([
    {
      master: { id: 1, name: "Master", template_id: "jakes", kind: "master", latex_source: "", updated_at: "2026-01-15T00:00:00Z" },
      variants: [
        { id: 2, name: "Master — Acme", template_id: "jakes", kind: "variant", latex_source: "", updated_at: "2026-01-15T00:00:00Z", parent_id: 1, job_description_id: 9, jd_title: "SWE", jd_company: "Acme" },
      ],
    },
  ]);
});

test("renders master and variant", async () => {
  render(<ResumeList onOpen={() => {}} />);
  await waitFor(() => expect(screen.getByText("Master")).toBeInTheDocument());
  expect(screen.getByText("Master — Acme")).toBeInTheDocument();
  expect(screen.getByText(/SWE @ Acme/)).toBeInTheDocument();
});

test("opens TailorModal when Tailor button clicked", async () => {
  render(<ResumeList onOpen={() => {}} />);
  await waitFor(() => expect(screen.getByText("Master")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /tailor to jd/i }));
  await waitFor(() => expect(screen.getByRole("dialog", { name: /tailor to jd/i })).toBeInTheDocument());
});

test("delete on master with variants prompts to promote", async () => {
  mockApi.deleteResume.mockResolvedValue(undefined);
  render(<ResumeList onOpen={() => {}} />);
  await waitFor(() => expect(screen.getByText("Master")).toBeInTheDocument());
  // Open kebab on the master (first kebab button on the page)
  const kebabs = screen.getAllByRole("button", { name: /more actions/i });
  fireEvent.click(kebabs[0]);
  fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
  await waitFor(() => expect(screen.getByRole("dialog", { name: /pick a new master/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /promote & delete/i }));
  await waitFor(() => expect(mockApi.deleteResume).toHaveBeenCalledWith(1, 2));
});

test("duplicate on master calls api", async () => {
  mockApi.duplicateResume.mockResolvedValue({});
  render(<ResumeList onOpen={() => {}} />);
  await waitFor(() => expect(screen.getByText("Master")).toBeInTheDocument());
  const kebabs = screen.getAllByRole("button", { name: /more actions/i });
  fireEvent.click(kebabs[0]);
  fireEvent.click(screen.getByRole("menuitem", { name: /duplicate/i }));
  await waitFor(() => expect(mockApi.duplicateResume).toHaveBeenCalledWith(1));
});

test("rename on master calls api", async () => {
  mockApi.renameResume.mockResolvedValue({});
  render(<ResumeList onOpen={() => {}} />);
  await waitFor(() => expect(screen.getByText("Master")).toBeInTheDocument());
  const kebabs = screen.getAllByRole("button", { name: /more actions/i });
  fireEvent.click(kebabs[0]);
  fireEvent.click(screen.getByRole("menuitem", { name: /rename/i }));
  const input = await screen.findByDisplayValue("Master");
  fireEvent.change(input, { target: { value: "Master Renamed" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(mockApi.renameResume).toHaveBeenCalledWith(1, "Master Renamed"));
});

test("view JD on variant fetches and renders", async () => {
  mockApi.getJd.mockResolvedValue({
    id: 9, title: "SWE", company: "Acme", url: "https://x/y", raw_text: "Body here", created_at: "2026-01-15T00:00:00Z",
  });
  render(<ResumeList onOpen={() => {}} />);
  await waitFor(() => expect(screen.getByText("Master")).toBeInTheDocument());
  const kebabs = screen.getAllByRole("button", { name: /more actions/i });
  // Variant kebab is the second one
  fireEvent.click(kebabs[1]);
  fireEvent.click(screen.getByRole("menuitem", { name: /view jd/i }));
  await waitFor(() => expect(mockApi.getJd).toHaveBeenCalledWith(9));
  await waitFor(() => expect(screen.getByText("Body here")).toBeInTheDocument());
});
