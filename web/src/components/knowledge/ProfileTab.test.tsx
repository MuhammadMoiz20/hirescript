import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ProfileTab from "./ProfileTab";
import { beforeEach, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  getProfile: vi.fn(),
  putProfile: vi.fn(),
}));

vi.mock("../../api", () => ({ api: mockApi }));

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

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  mockApi.getProfile.mockResolvedValue({ ...baseProfile });
});

test("renders existing profile values in the form", async () => {
  render(<ProfileTab />);
  await waitFor(() => expect(screen.getByDisplayValue("Existing")).toBeInTheDocument());
  expect(screen.getByDisplayValue("user@example.com")).toBeInTheDocument();
});

test("editing a field and clicking Save calls putProfile with the new payload", async () => {
  mockApi.putProfile.mockImplementation(async (p) => p);
  render(<ProfileTab />);
  const legal = await screen.findByLabelText(/legal name/i);
  fireEvent.change(legal, { target: { value: "New Name" } });
  fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]);
  await waitFor(() => expect(mockApi.putProfile).toHaveBeenCalled());
  const arg = mockApi.putProfile.mock.calls[0][0];
  expect(arg.legal_name).toBe("New Name");
  expect(arg.email).toBe("user@example.com");
});

test("server 422 with field error renders an inline error", async () => {
  mockApi.putProfile.mockRejectedValue({
    status: 422,
    detail: [{ loc: ["body", "email"], msg: "value is not a valid email address" }],
  });
  render(<ProfileTab />);
  const email = await screen.findByLabelText(/^email$/i);
  fireEvent.change(email, { target: { value: "not-an-email" } });
  fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]);
  await waitFor(() =>
    expect(screen.getByText(/value is not a valid email address/i)).toBeInTheDocument(),
  );
  expect(email).toHaveAttribute("aria-invalid", "true");
});
