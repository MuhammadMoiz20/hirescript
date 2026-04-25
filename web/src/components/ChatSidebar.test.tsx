import { vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChatSidebar from "./ChatSidebar";

vi.mock("../api", () => {
  const streamEdit = vi.fn(async (_id, _instruction, _tier, cb) => {
    cb.onChunk?.("Hel");
    cb.onChunk?.("lo");
    cb.onResult?.({
      proposed_latex: "...",
      page_count: 1,
      enforced: true,
      iterations: 0,
      tier_history: [],
      removed_terms: [],
    });
  });
  return { api: { streamEdit }, streamEdit };
});

test("renders streamed tokens and calls onProposed when result arrives", async () => {
  const onProposed = vi.fn();
  render(<ChatSidebar resumeId={1} onProposed={onProposed} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Tighten everything" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect(screen.getByText(/Hello/)).toBeInTheDocument());
  await waitFor(() => expect(onProposed).toHaveBeenCalledWith(expect.objectContaining({ enforced: true })));
});

test("disables Send while streaming", async () => {
  const { api } = await import("../api");
  (api.streamEdit as any).mockImplementationOnce(() => new Promise(() => {}));
  render(<ChatSidebar resumeId={1} onProposed={() => {}} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(true));
});

test("shows error when onError fires", async () => {
  const { api } = await import("../api");
  (api.streamEdit as any).mockImplementationOnce(async (_id: number, _i: string, _t: any, cb: any) => {
    cb.onError?.("boom");
  });
  render(<ChatSidebar resumeId={1} onProposed={() => {}} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
});
