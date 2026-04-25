import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import NewResumeMenu from "./NewResumeMenu";

vi.mock("../api", () => ({
  api: {
    createResume: vi.fn(async () => ({ id: 1, name: "x", template_id: "jakes", kind: "master", latex_source: "", updated_at: "" })),
    onboardTex: vi.fn(async () => ({ id: 2, name: "x", template_id: "jakes", kind: "master", latex_source: "", updated_at: "", enforced: true, iterations: 0, page_count: 1 })),
    onboardPdf: vi.fn(async () => ({ id: 3, name: "x", template_id: "jakes", kind: "master", latex_source: "", updated_at: "", enforced: true, iterations: 0, page_count: 1 })),
  },
}));

test("scratch mode calls createResume", async () => {
  const onCreated = vi.fn();
  render(<NewResumeMenu onCreated={onCreated} />);
  fireEvent.change(screen.getByLabelText(/resume name/i), { target: { value: "S" } });
  fireEvent.click(screen.getByRole("button", { name: /create/i }));
  const { api } = await import("../api");
  await waitFor(() => expect(api.createResume).toHaveBeenCalledWith("S", "jakes"));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
});

test("paste-LaTeX mode calls onboardTex", async () => {
  render(<NewResumeMenu onCreated={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /paste latex/i }));
  fireEvent.change(screen.getByLabelText(/resume name/i), { target: { value: "Tex" } });
  fireEvent.change(screen.getByLabelText(/latex source/i), { target: { value: "\\documentclass{article}\\begin{document}x\\end{document}" } });
  fireEvent.click(screen.getByRole("button", { name: /create/i }));
  const { api } = await import("../api");
  await waitFor(() => expect(api.onboardTex).toHaveBeenCalled());
});

test("PDF mode calls onboardPdf", async () => {
  render(<NewResumeMenu onCreated={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /from pdf/i }));
  fireEvent.change(screen.getByLabelText(/resume name/i), { target: { value: "P" } });
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "r.pdf", { type: "application/pdf" });
  const input = screen.getByLabelText(/pdf file/i) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file] });
  fireEvent.change(input);
  fireEvent.click(screen.getByRole("button", { name: /create/i }));
  const { api } = await import("../api");
  await waitFor(() => expect(api.onboardPdf).toHaveBeenCalled());
});

test("warns when imported resume overflows", async () => {
  const { api } = await import("../api");
  (api.onboardTex as any).mockResolvedValueOnce({ id: 9, name: "x", template_id: "jakes", kind: "master", latex_source: "", updated_at: "", enforced: false, iterations: 4, page_count: 2 });
  render(<NewResumeMenu onCreated={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /paste latex/i }));
  fireEvent.change(screen.getByLabelText(/resume name/i), { target: { value: "Big" } });
  fireEvent.change(screen.getByLabelText(/latex source/i), { target: { value: "\\documentclass{article}\\begin{document}\\end{document}" } });
  fireEvent.click(screen.getByRole("button", { name: /create/i }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/2 page/));
});
