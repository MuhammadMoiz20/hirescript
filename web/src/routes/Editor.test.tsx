import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, vi, test, expect } from "vitest";
import Editor from "./Editor";

const mockApi = vi.hoisted(() => ({
  getResume: vi.fn(),
  getSections: vi.fn(),
  compileResume: vi.fn(),
  updateResume: vi.fn(),
  enforceOneLine: vi.fn(),
  repairResume: vi.fn(),
  acceptEdit: vi.fn(),
  putSections: vi.fn(),
}));

vi.mock("../api", () => ({ api: mockApi }));

vi.mock("../components/PdfPreview", () => ({
  default: () => <div data-testid="pdf-preview" />,
}));

vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      data-testid="cm"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => "desktop",
}));

vi.mock("../components/ChatSidebar", () => ({ default: () => <div /> }));
vi.mock("../components/SectionFormEditor", () => ({ default: () => <div /> }));
vi.mock("../components/VersionHistory", () => ({ default: () => <div /> }));

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  mockApi.getResume.mockResolvedValue({
    id: 42,
    name: "My Resume",
    latex_source: "\\documentclass{article}",
    template_id: "jakes",
    kind: "master",
    one_line_per_bullet: false,
  });
  mockApi.getSections.mockResolvedValue({ sections: [], content: {} });
  mockApi.compileResume.mockResolvedValue({
    pdf: new Blob(["pdf"]),
    pageCount: 1,
    overflowCount: 0,
  });
  mockApi.updateResume.mockResolvedValue({});
});

test("renders the enforce-one-line button", async () => {
  render(<Editor id={42} onBack={() => {}} />);
  await waitFor(() => expect(mockApi.getResume).toHaveBeenCalled());
  expect(
    await screen.findByRole("button", {
      name: /Enforce one-line per bullet → save as new/i,
    }),
  ).toBeInTheDocument();
});

test("clicking the button confirms and calls api.enforceOneLine, then opens new resume", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  mockApi.enforceOneLine.mockResolvedValue({
    id: 99,
    name: "My Resume (one-line)",
    latex_source: "...",
    template_id: "jakes",
    kind: "master",
    one_line_per_bullet: true,
  });
  const onOpenResume = vi.fn();
  render(<Editor id={42} onBack={() => {}} onOpenResume={onOpenResume} />);
  await waitFor(() => expect(mockApi.getResume).toHaveBeenCalled());

  const btn = await screen.findByRole("button", {
    name: /Enforce one-line per bullet → save as new/i,
  });
  fireEvent.click(btn);

  await waitFor(() => expect(mockApi.enforceOneLine).toHaveBeenCalledWith(42));
  expect(confirmSpy).toHaveBeenCalled();
  await waitFor(() => expect(onOpenResume).toHaveBeenCalledWith(99));
  confirmSpy.mockRestore();
});

test("cancelling the confirm prevents the API call", async () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<Editor id={42} onBack={() => {}} />);
  await waitFor(() => expect(mockApi.getResume).toHaveBeenCalled());

  const btn = await screen.findByRole("button", {
    name: /Enforce one-line per bullet → save as new/i,
  });
  fireEvent.click(btn);

  expect(confirmSpy).toHaveBeenCalled();
  expect(mockApi.enforceOneLine).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

test("surfaces error when enforceOneLine fails", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mockApi.enforceOneLine.mockRejectedValue({ detail: { message: "boom" } });
  render(<Editor id={42} onBack={() => {}} />);
  await waitFor(() => expect(mockApi.getResume).toHaveBeenCalled());

  fireEvent.click(
    await screen.findByRole("button", {
      name: /Enforce one-line per bullet → save as new/i,
    }),
  );
  await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
});
