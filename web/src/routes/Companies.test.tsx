import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { beforeEach, vi, test, expect } from "vitest";
import Companies from "./Companies";

const mockApi = vi.hoisted(() => ({
  listCompanies: vi.fn(),
  createCompany: vi.fn(),
  updateCompany: vi.fn(),
  deleteCompany: vi.fn(),
}));

vi.mock("../api", () => ({ api: mockApi }));

const sample = [
  {
    id: 1,
    source: "greenhouse",
    slug: "anthropic",
    display_name: "Anthropic",
    enabled: true,
    created_at: "2026-04-01T00:00:00Z",
  },
  {
    id: 2,
    source: "greenhouse",
    slug: "openai",
    display_name: "OpenAI",
    enabled: true,
    created_at: "2026-04-02T00:00:00Z",
  },
  {
    id: 3,
    source: "lever",
    slug: "netflix",
    display_name: "Netflix",
    enabled: false,
    created_at: "2026-04-03T00:00:00Z",
  },
];

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  mockApi.listCompanies.mockResolvedValue(sample);
});

test("renders companies grouped by source", async () => {
  render(<Companies />);
  await waitFor(() => expect(mockApi.listCompanies).toHaveBeenCalled());

  // Two greenhouse, one lever — group headers visible.
  expect(await screen.findByTestId("companies-group-greenhouse")).toBeInTheDocument();
  expect(screen.getByTestId("companies-group-lever")).toBeInTheDocument();

  const ghGroup = screen.getByTestId("companies-group-greenhouse");
  expect(within(ghGroup).getByText("Anthropic")).toBeInTheDocument();
  expect(within(ghGroup).getByText("OpenAI")).toBeInTheDocument();

  const leverGroup = screen.getByTestId("companies-group-lever");
  expect(within(leverGroup).getByText("Netflix")).toBeInTheDocument();
});

test("toggling enabled fires PATCH and updates the row", async () => {
  mockApi.updateCompany.mockResolvedValue({ ...sample[0], enabled: false });
  render(<Companies />);
  await screen.findByText("Anthropic");

  const toggle = screen.getByTestId("company-toggle-1");
  fireEvent.click(toggle);

  await waitFor(() =>
    expect(mockApi.updateCompany).toHaveBeenCalledWith(1, { enabled: false }),
  );
});

test("rolls back optimistic toggle on error", async () => {
  mockApi.updateCompany.mockRejectedValue({ status: 500, detail: "boom" });
  render(<Companies />);
  await screen.findByText("Anthropic");

  const toggle = screen.getByTestId("company-toggle-1") as HTMLInputElement;
  expect(toggle.checked).toBe(true);
  fireEvent.click(toggle);

  await waitFor(() => expect(mockApi.updateCompany).toHaveBeenCalled());
  // After rollback, still checked.
  await waitFor(() =>
    expect((screen.getByTestId("company-toggle-1") as HTMLInputElement).checked).toBe(true),
  );
});

test("deleting a company removes the row", async () => {
  mockApi.deleteCompany.mockResolvedValue(undefined);
  render(<Companies />);
  await screen.findByText("Anthropic");

  fireEvent.click(screen.getByTestId("company-delete-1"));
  await waitFor(() => expect(mockApi.deleteCompany).toHaveBeenCalledWith(1));
  await waitFor(() => expect(screen.queryByText("Anthropic")).not.toBeInTheDocument());
});

test("happy-path: add a new company", async () => {
  const fresh = {
    id: 99,
    source: "ashby",
    slug: "notion",
    display_name: "Notion",
    enabled: true,
    created_at: "2026-04-27T00:00:00Z",
  };
  mockApi.createCompany.mockResolvedValue(fresh);

  render(<Companies />);
  await screen.findByText("Anthropic");

  fireEvent.change(screen.getByTestId("companies-add-source"), { target: { value: "ashby" } });
  fireEvent.change(screen.getByTestId("companies-add-slug"), { target: { value: "notion" } });
  fireEvent.change(screen.getByTestId("companies-add-name"), { target: { value: "Notion" } });
  fireEvent.click(screen.getByTestId("companies-add-submit"));

  await waitFor(() =>
    expect(mockApi.createCompany).toHaveBeenCalledWith({
      source: "ashby",
      slug: "notion",
      display_name: "Notion",
    }),
  );
  expect(await screen.findByText("Notion")).toBeInTheDocument();
});

test("422 validation error renders inline near the form", async () => {
  mockApi.createCompany.mockRejectedValue({
    status: 422,
    detail: "Slug 'bogus' yielded zero postings",
  });

  render(<Companies />);
  await screen.findByText("Anthropic");

  fireEvent.change(screen.getByTestId("companies-add-source"), { target: { value: "lever" } });
  fireEvent.change(screen.getByTestId("companies-add-slug"), { target: { value: "bogus" } });
  fireEvent.change(screen.getByTestId("companies-add-name"), { target: { value: "Bogus" } });
  fireEvent.click(screen.getByTestId("companies-add-submit"));

  expect(await screen.findByTestId("companies-add-error")).toHaveTextContent(/zero postings/i);
});
