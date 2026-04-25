import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ResumeList from "./ResumeList";
import { vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    listGroupedResumes: vi.fn().mockResolvedValue([
      {
        master: { id: 1, name: "Master", template_id: "jakes", kind: "master", latex_source: "", updated_at: "" },
        variants: [
          { id: 2, name: "Master — Acme", template_id: "jakes", kind: "variant", latex_source: "", updated_at: "", parent_id: 1, job_description_id: 9, jd_title: "SWE", jd_company: "Acme" },
        ],
      },
    ]),
    createResume: vi.fn(),
  },
}));

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
  // Modal renders; aria-label="Tailor to JD"
  await waitFor(() => expect(screen.getByRole("dialog", { name: /tailor to jd/i })).toBeInTheDocument());
});
