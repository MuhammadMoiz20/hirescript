import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import Onboarding from "./Onboarding";

vi.mock("../api", () => ({
  api: {
    createResume: vi.fn(async () => ({
      id: 1, name: "x", template_id: "jakes", kind: "master", latex_source: "", updated_at: "",
    })),
    onboardTex: vi.fn(async () => ({
      id: 2, name: "x", template_id: "jakes", kind: "master", latex_source: "", updated_at: "",
      enforced: true, iterations: 0, page_count: 1,
    })),
    onboardPdf: vi.fn(async () => ({
      id: 3, name: "x", template_id: "jakes", kind: "master", latex_source: "", updated_at: "",
      enforced: true, iterations: 0, page_count: 1,
    })),
  },
}));

test("renders the three path cards", () => {
  render(<Onboarding onCancel={() => {}} onCreated={() => {}} />);
  expect(screen.getByRole("button", { name: /start from scratch/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /paste latex/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /upload pdf/i })).toBeInTheDocument();
});

test("scratch mode calls createResume", async () => {
  const onCreated = vi.fn();
  render(<Onboarding onCancel={() => {}} onCreated={onCreated} />);
  fireEvent.click(screen.getByRole("button", { name: /start from scratch/i }));
  fireEvent.change(screen.getByLabelText(/resume name/i), { target: { value: "S" } });
  fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
  const { api } = await import("../api");
  await waitFor(() => expect(api.createResume).toHaveBeenCalledWith("S", "jakes"));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
});

test("paste LaTeX mode calls onboardTex", async () => {
  render(<Onboarding onCancel={() => {}} onCreated={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /paste latex/i }));
  fireEvent.change(screen.getByLabelText(/resume name/i), { target: { value: "Tex" } });
  fireEvent.change(screen.getByLabelText(/latex source/i), {
    target: { value: "\\documentclass{article}\\begin{document}x\\end{document}" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
  const { api } = await import("../api");
  await waitFor(() => expect(api.onboardTex).toHaveBeenCalled());
});

test("PDF mode calls onboardPdf", async () => {
  render(<Onboarding onCancel={() => {}} onCreated={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /upload pdf/i }));
  fireEvent.change(screen.getByLabelText(/resume name/i), { target: { value: "P" } });
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "r.pdf", { type: "application/pdf" });
  const input = screen.getByLabelText(/pdf file/i) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file] });
  fireEvent.change(input);
  fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
  const { api } = await import("../api");
  await waitFor(() => expect(api.onboardPdf).toHaveBeenCalled());
});

test("renders eyebrow + serif page title and breadcrumb back to library", () => {
  const onCancel = vi.fn();
  render(<Onboarding onCancel={onCancel} onCreated={() => {}} />);
  // Eyebrow + page title
  expect(screen.getByText(/onboarding/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: /start a new resume/i })).toBeInTheDocument();
  // Back-to-library breadcrumb wired to onCancel
  fireEvent.click(screen.getByTestId("onboarding-back"));
  expect(onCancel).toHaveBeenCalled();
});

test("hides the form panel until a source is picked", () => {
  render(<Onboarding onCancel={() => {}} onCreated={() => {}} />);
  // Resume name field is part of the conditional details panel
  expect(screen.queryByLabelText(/resume name/i)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /start from scratch/i }));
  expect(screen.getByLabelText(/resume name/i)).toBeInTheDocument();
});

test("warns when imported resume overflows", async () => {
  const { api } = await import("../api");
  (api.onboardTex as any).mockResolvedValueOnce({
    id: 9, name: "x", template_id: "jakes", kind: "master", latex_source: "", updated_at: "",
    enforced: false, iterations: 4, page_count: 2,
  });
  render(<Onboarding onCancel={() => {}} onCreated={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /paste latex/i }));
  fireEvent.change(screen.getByLabelText(/resume name/i), { target: { value: "Big" } });
  fireEvent.change(screen.getByLabelText(/latex source/i), {
    target: { value: "\\documentclass{article}\\begin{document}\\end{document}" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/2 page/));
});
