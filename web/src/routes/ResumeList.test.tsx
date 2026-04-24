import { render, screen, waitFor } from "@testing-library/react";
import ResumeList from "./ResumeList";
import { vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    listResumes: vi.fn().mockResolvedValue([{ id: 1, name: "R1", template_id: "jakes", latex_source: "", updated_at: "" }]),
    createResume: vi.fn(),
  },
}));

test("renders the list", async () => {
  render(<ResumeList onOpen={() => {}} />);
  await waitFor(() => expect(screen.getByText("R1")).toBeInTheDocument());
});
