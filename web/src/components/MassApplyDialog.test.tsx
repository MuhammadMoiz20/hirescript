import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { vi, test, expect, beforeEach } from "vitest";
import MassApplyDialog from "./MassApplyDialog";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../api", () => ({
  enqueueTailorBatch: vi.fn(),
}));

beforeEach(async () => {
  mockNavigate.mockReset();
  const { enqueueTailorBatch } = await import("../api");
  (enqueueTailorBatch as any).mockReset();
  (enqueueTailorBatch as any).mockResolvedValue({ batch_id: "batch-123", job_ids: ["j1", "j2"] });
});

function fillEntry(idx: number, fields: { title?: string; company?: string; url?: string; jdText?: string }) {
  const entries = screen.getAllByTestId("mass-apply-entry");
  const entry = entries[idx];
  if (fields.title !== undefined) {
    fireEvent.change(within(entry).getByLabelText(/title/i), { target: { value: fields.title } });
  }
  if (fields.company !== undefined) {
    fireEvent.change(within(entry).getByLabelText(/company/i), { target: { value: fields.company } });
  }
  if (fields.url !== undefined) {
    fireEvent.change(within(entry).getByLabelText(/url/i), { target: { value: fields.url } });
  }
  if (fields.jdText !== undefined) {
    fireEvent.change(within(entry).getByLabelText(/job description/i), { target: { value: fields.jdText } });
  }
}

test("fills two JDs and submits — calls enqueueTailorBatch with both items", async () => {
  const onClose = vi.fn();
  render(
    <MassApplyDialog
      open={true}
      masterId={42}
      masterName="Master Resume"
      onClose={onClose}
    />,
  );

  // First entry already exists
  fillEntry(0, { title: "SWE", company: "Acme", jdText: "JD body A" });

  fireEvent.click(screen.getByRole("button", { name: /add another jd/i }));

  fillEntry(1, { title: "SWE II", company: "Beta", url: "https://beta/jobs/1", jdText: "JD body B" });

  fireEvent.click(screen.getByRole("button", { name: /^submit/i }));

  const { enqueueTailorBatch } = await import("../api");
  await waitFor(() => expect(enqueueTailorBatch).toHaveBeenCalledTimes(1));
  const call = (enqueueTailorBatch as any).mock.calls[0][0];
  expect(call.resume_id).toBe(42);
  expect(call.items).toHaveLength(2);
  expect(call.items[0]).toMatchObject({ title: "SWE", company: "Acme", jd_text: "JD body A" });
  expect(call.items[1]).toMatchObject({ title: "SWE II", company: "Beta", url: "https://beta/jobs/1", jd_text: "JD body B" });
  expect(call.deep).toBe(false);
});

test("Add JD button appends row, Remove deletes", async () => {
  render(
    <MassApplyDialog
      open={true}
      masterId={1}
      masterName="Master"
      onClose={() => {}}
    />,
  );

  expect(screen.getAllByTestId("mass-apply-entry")).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: /add another jd/i }));
  expect(screen.getAllByTestId("mass-apply-entry")).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: /add another jd/i }));
  expect(screen.getAllByTestId("mass-apply-entry")).toHaveLength(3);

  const removeButtons = screen.getAllByRole("button", { name: /^remove$/i });
  fireEvent.click(removeButtons[0]);
  expect(screen.getAllByTestId("mass-apply-entry")).toHaveLength(2);
});

test("Submit disabled until all rows valid", async () => {
  render(
    <MassApplyDialog
      open={true}
      masterId={1}
      masterName="Master"
      onClose={() => {}}
    />,
  );

  const submit = screen.getByRole("button", { name: /^submit/i }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);

  fillEntry(0, { title: "SWE", company: "Acme", jdText: "JD body" });
  expect(submit.disabled).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: /add another jd/i }));
  // second row empty — submit should disable again
  expect((screen.getByRole("button", { name: /^submit/i }) as HTMLButtonElement).disabled).toBe(true);

  fillEntry(1, { title: "SWE II", company: "Beta", jdText: "JD body B" });
  expect((screen.getByRole("button", { name: /^submit/i }) as HTMLButtonElement).disabled).toBe(false);

  // blank a required field
  fillEntry(1, { company: "" });
  expect((screen.getByRole("button", { name: /^submit/i }) as HTMLButtonElement).disabled).toBe(true);
});

test("on success navigates to /jobs?batch=<id> and closes", async () => {
  const onClose = vi.fn();
  render(
    <MassApplyDialog
      open={true}
      masterId={7}
      masterName="Master"
      onClose={onClose}
    />,
  );

  fillEntry(0, { title: "SWE", company: "Acme", jdText: "JD body" });
  fireEvent.click(screen.getByRole("button", { name: /^submit/i }));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/jobs?batch=batch-123"));
  expect(onClose).toHaveBeenCalled();
});

test("error from enqueueTailorBatch surfaces inline", async () => {
  const { enqueueTailorBatch } = await import("../api");
  (enqueueTailorBatch as any).mockRejectedValue(new Error("queue down"));

  render(
    <MassApplyDialog
      open={true}
      masterId={1}
      masterName="Master"
      onClose={() => {}}
    />,
  );

  fillEntry(0, { title: "SWE", company: "Acme", jdText: "JD body" });
  fireEvent.click(screen.getByRole("button", { name: /^submit/i }));

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/queue down/i));
});
