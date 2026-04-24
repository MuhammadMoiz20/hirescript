import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import TailorModal from "./TailorModal";

vi.mock("../api", () => ({
  api: {
    tailorToJd: vi.fn(async () => ({
      variant: { id: 5, name: "M — Acme", template_id: "jakes", kind: "variant", latex_source: "", updated_at: "" },
      jd_id: 1,
      page_count: 1,
      iterations: 0,
      enforced: true,
      tier_history: [],
      keywords_used: ["python"],
    })),
  },
}));

function setup(extra = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<TailorModal masterId={1} masterName="Master" open={true} onClose={onClose} onCreated={onCreated} {...extra} />);
  return { onClose, onCreated };
}

test("renders nothing when open=false", () => {
  const { container } = render(<TailorModal masterId={1} masterName="M" open={false} onClose={() => {}} onCreated={() => {}} />);
  expect(container.firstChild).toBeNull();
});

test("submit disabled until required fields filled", () => {
  setup();
  expect(screen.getByRole("button", { name: /^tailor$/i })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "SWE" } });
  fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "Acme" } });
  fireEvent.change(screen.getByLabelText(/job description/i), { target: { value: "JD" } });
  expect(screen.getByRole("button", { name: /^tailor$/i })).not.toBeDisabled();
});

test("calls tailorToJd and onCreated on success", async () => {
  const { onCreated } = setup();
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "SWE" } });
  fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "Acme" } });
  fireEvent.change(screen.getByLabelText(/job description/i), { target: { value: "JD body" } });
  fireEvent.click(screen.getByRole("button", { name: /^tailor$/i }));
  const { api } = await import("../api");
  await waitFor(() => expect(api.tailorToJd).toHaveBeenCalledWith(1, expect.objectContaining({ company: "Acme" })));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
});

test("shows not_one_page error", async () => {
  const { api } = await import("../api");
  (api.tailorToJd as any).mockRejectedValueOnce({ detail: { error: "not_one_page", page_count: 2, iterations: 4 } });
  setup();
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "x" } });
  fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "y" } });
  fireEvent.change(screen.getByLabelText(/job description/i), { target: { value: "z" } });
  fireEvent.click(screen.getByRole("button", { name: /^tailor$/i }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/2 page/));
});

test("Cancel calls onClose", () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onClose).toHaveBeenCalled();
});
