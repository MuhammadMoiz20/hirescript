import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import VersionHistory from "./VersionHistory";

vi.mock("../api", () => ({
  api: {
    listVersions: vi.fn(async () => [
      { id: 7, edit_source: "manual",  edit_prompt: null,         page_count: 1, created_at: "2026-04-29T10:00:00Z" },
      { id: 8, edit_source: "ai_chat", edit_prompt: "tighten exp", page_count: 1, created_at: "2026-04-29T11:00:00Z" },
    ]),
    rollback: vi.fn(async () => ({
      id: 1, name: "X", template_id: "jakes", kind: "master", latex_source: "rolled-back", updated_at: "",
    })),
  },
}));

test("lists versions", async () => {
  render(<VersionHistory resumeId={1} onRolledBack={() => {}} />);
  await waitFor(() => expect(screen.getByText("manual")).toBeInTheDocument());
  expect(screen.getByText("ai_chat")).toBeInTheDocument();
  expect(screen.getByText("tighten exp")).toBeInTheDocument();
});

test("rollback calls api and onRolledBack", async () => {
  const onRolledBack = vi.fn();
  render(<VersionHistory resumeId={1} onRolledBack={onRolledBack} />);
  await waitFor(() => expect(screen.getByText("manual")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /rollback to v7/i }));
  const { api } = await import("../api");
  await waitFor(() => expect(api.rollback).toHaveBeenCalledWith(1, 7));
  await waitFor(() => expect(onRolledBack).toHaveBeenCalledWith(expect.objectContaining({ latex_source: "rolled-back" })));
});

test("shows empty state", async () => {
  const { api } = await import("../api");
  (api.listVersions as any).mockResolvedValueOnce([]);
  render(<VersionHistory resumeId={1} onRolledBack={() => {}} />);
  await waitFor(() => expect(screen.getByText(/no versions yet/i)).toBeInTheDocument());
});
