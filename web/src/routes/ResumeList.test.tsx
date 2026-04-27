import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
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
      master: {
        id: 1,
        name: "Master",
        template_id: "jakes",
        kind: "master",
        latex_source: "",
        updated_at: "2026-01-15T00:00:00Z",
      },
      variants: [
        {
          id: 2,
          name: "Master — Acme",
          template_id: "jakes",
          kind: "variant",
          latex_source: "",
          updated_at: "2026-01-15T00:00:00Z",
          parent_id: 1,
          job_description_id: 9,
          jd_title: "SWE",
          jd_company: "Acme",
        },
      ],
    },
  ]);
});

test("renders master and variant in Library layout", async () => {
  render(<ResumeList onOpen={() => {}} />);
  const masterCard = await screen.findByTestId("master-card");

  // Library page heading uses Source Serif
  const heading = screen.getByRole("heading", { name: "Library", level: 1 });
  expect(heading).toBeInTheDocument();
  expect(heading.style.fontFamily).toContain("--f-serif");

  // Master card: serif title and master pill both render the word "Master"
  const masterTexts = within(masterCard).getAllByText("Master");
  expect(masterTexts.length).toBeGreaterThanOrEqual(2);
  // Find the serif title (h2 child)
  const serifTitle = masterTexts.find((el) => el.style.fontFamily.includes("--f-serif"));
  expect(serifTitle).toBeDefined();
  // Master pill
  expect(within(masterCard).getByText("Master", { selector: "span.mono" })).toBeInTheDocument();
  expect(within(masterCard).getByText("jakes")).toBeInTheDocument();

  // Variant row: company in JD column rendered, dedicated row testid
  const variantRow = screen.getByTestId("variant-row");
  expect(within(variantRow).getByText("Master — Acme")).toBeInTheDocument();
  expect(within(variantRow).getByText("Acme")).toBeInTheDocument();
  expect(within(variantRow).getByText("SWE")).toBeInTheDocument();
});

test("renders PageCountBadge with unknown state and CompileChip queued on master", async () => {
  render(<ResumeList onOpen={() => {}} />);
  await screen.findByTestId("master-card");

  const masterCard = screen.getByTestId("master-card");

  // PageCountBadge defaults to unknown when no compile signal is loaded.
  const masterBadge = within(masterCard)
    .getAllByRole("status")
    .find((el) => el.getAttribute("data-state") === "unknown");
  expect(masterBadge).toBeDefined();

  // CompileChip placeholder shows queued state.
  const compileChip = within(masterCard)
    .getAllByRole("status")
    .find((el) => el.getAttribute("data-kind") === "queued");
  expect(compileChip).toBeDefined();
  expect(compileChip!).toHaveTextContent(/queued/i);
});

test("variant row renders sm PageCountBadge with unknown state", async () => {
  render(<ResumeList onOpen={() => {}} />);
  await screen.findByTestId("master-card");
  const variantRow = screen.getByTestId("variant-row");
  const badge = within(variantRow)
    .getAllByRole("status")
    .find((el) => el.getAttribute("data-state") === "unknown");
  expect(badge).toBeDefined();
});

test("variant row title click triggers onOpen", async () => {
  const onOpen = vi.fn();
  render(<ResumeList onOpen={onOpen} />);
  await screen.findByTestId("master-card");
  const variantRow = screen.getByTestId("variant-row");
  fireEvent.click(within(variantRow).getByRole("button", { name: /open master — acme/i }));
  expect(onOpen).toHaveBeenCalledWith(2);
});

test("opens TailorModal when Tailor button clicked", async () => {
  render(<ResumeList onOpen={() => {}} />);
  await screen.findByTestId("master-card");
  fireEvent.click(screen.getByRole("button", { name: /tailor to jd/i }));
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: /tailor to jd/i })).toBeInTheDocument(),
  );
});

test("delete on master with variants prompts to promote", async () => {
  mockApi.deleteResume.mockResolvedValue(undefined);
  render(<ResumeList onOpen={() => {}} />);
  await screen.findByTestId("master-card");
  // Open kebab on the master (first kebab button on the page)
  const kebabs = screen.getAllByRole("button", { name: /more actions/i });
  fireEvent.click(kebabs[0]);
  fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: /pick a new master/i })).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: /promote & delete/i }));
  await waitFor(() => expect(mockApi.deleteResume).toHaveBeenCalledWith(1, 2));
});

test("duplicate on master calls api", async () => {
  mockApi.duplicateResume.mockResolvedValue({});
  render(<ResumeList onOpen={() => {}} />);
  await screen.findByTestId("master-card");
  const kebabs = screen.getAllByRole("button", { name: /more actions/i });
  fireEvent.click(kebabs[0]);
  fireEvent.click(screen.getByRole("menuitem", { name: /duplicate/i }));
  await waitFor(() => expect(mockApi.duplicateResume).toHaveBeenCalledWith(1));
});

test("rename on master calls api", async () => {
  mockApi.renameResume.mockResolvedValue({});
  render(<ResumeList onOpen={() => {}} />);
  await screen.findByTestId("master-card");
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
    id: 9,
    title: "SWE",
    company: "Acme",
    url: "https://x/y",
    raw_text: "Body here",
    created_at: "2026-01-15T00:00:00Z",
  });
  render(<ResumeList onOpen={() => {}} />);
  await screen.findByTestId("master-card");
  const kebabs = screen.getAllByRole("button", { name: /more actions/i });
  // Variant kebab is the second one
  fireEvent.click(kebabs[1]);
  fireEvent.click(screen.getByRole("menuitem", { name: /view jd/i }));
  await waitFor(() => expect(mockApi.getJd).toHaveBeenCalledWith(9));
  await waitFor(() => expect(screen.getByText("Body here")).toBeInTheDocument());
});

test("empty state renders when no resumes", async () => {
  mockApi.listGroupedResumes.mockResolvedValueOnce([]);
  render(<ResumeList onOpen={() => {}} />);
  await waitFor(() => expect(screen.getByTestId("library-empty")).toBeInTheDocument());
  expect(screen.getByRole("heading", { name: /no resumes yet/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /new resume/i })).toBeInTheDocument();
});
