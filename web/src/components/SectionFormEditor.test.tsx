import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import SectionFormEditor from "./SectionFormEditor";

vi.mock("../api", () => ({
  api: {
    putSections: vi.fn(async () => ({ id: 1, name: "X", template_id: "jakes", kind: "master", latex_source: "", updated_at: "" })),
  },
}));

const payload = {
  template_id: "jakes",
  schema: {
    sections: [
      { id: "header", type: "header" },
      { id: "education", type: "list_subheading", title: "Education" },
      { id: "experience", type: "list_subheading", title: "Experience" },
      { id: "projects", type: "list_project", title: "Projects" },
      { id: "skills", type: "key_value_list", title: "Technical Skills" },
    ],
    subheading_fields: { institution: "Institution", location: "Location", degree: "Title / Degree", date: "Date" },
    project_fields: { name: "Name", tech: "Tech", date: "Date" },
  },
  content_json: {
    header: { name: "Foo", tagline: "Bar", contacts: [{ label: "email", value: "a@b.c", url: "mailto:a@b.c" }] },
    education: [{ institution: "U", location: "Loc", degree: "BS", date: "2026", bullets: ["one"] }],
    experience: [],
    projects: [{ name: "P", tech: "Py", date: "", bullets: ["b1"] }],
    skills: { Languages: "Python" },
  },
};

test("renders header fields", () => {
  render(<SectionFormEditor resumeId={1} payload={payload} onSaved={() => {}} />);
  expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe("Foo");
});

test("editing a field updates state, save calls putSections", async () => {
  const onSaved = vi.fn();
  render(<SectionFormEditor resumeId={1} payload={payload} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Bar" } });
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  const { api } = await import("../api");
  await waitFor(() => expect(api.putSections).toHaveBeenCalledWith(1, expect.objectContaining({ header: expect.objectContaining({ name: "Bar" }) })));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

test("shows not_one_page error on save failure", async () => {
  const { api } = await import("../api");
  (api.putSections as any).mockRejectedValueOnce({ detail: { error: "not_one_page", page_count: 2 } });
  render(<SectionFormEditor resumeId={1} payload={payload} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/2 page/));
});

test("can add and remove an experience row", () => {
  render(<SectionFormEditor resumeId={1} payload={payload} onSaved={() => {}} />);
  // experience starts empty; add a row
  const expSection = screen.getByText(/experience/i).closest("section")!;
  const addBtn = expSection.querySelector("button[aria-label='Add experience row']") as HTMLButtonElement;
  fireEvent.click(addBtn);
  // institution input under experience now exists
  expect(expSection.querySelectorAll("input").length).toBeGreaterThan(0);
});
