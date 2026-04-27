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

test("renders bundle empty-state copy when no messages yet", () => {
  render(<ChatSidebar resumeId={1} onProposed={() => {}} />);
  // Bundle voice: matter-of-fact, action-oriented prompt for the chat rail.
  expect(screen.getByText(/Ask Claude/i)).toBeInTheDocument();
  expect(screen.getByText(/reviewable diff/i)).toBeInTheDocument();
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

test("clear button removes prior messages", async () => {
  const onProposed = vi.fn();
  render(<ChatSidebar resumeId={1} onProposed={onProposed} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Tighten everything" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect(screen.getByText(/Hello/)).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /clear chat/i }));
  await waitFor(() => expect(screen.queryByText(/Hello/)).not.toBeInTheDocument());
  expect(screen.queryByText(/Tighten everything/)).not.toBeInTheDocument();
});

test("sends history and currentLatex on follow-up turns", async () => {
  const { api } = await import("../api");
  (api.streamEdit as any).mockClear();
  render(
    <ChatSidebar
      resumeId={1}
      onProposed={() => {}}
      getCurrentLatex={() => "\\documentclass{article}"}
    />,
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "first turn" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect(screen.getByText(/Hello/)).toBeInTheDocument());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "second turn" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect((api.streamEdit as any).mock.calls.length).toBeGreaterThanOrEqual(2));
  const secondCall = (api.streamEdit as any).mock.calls[1];
  // signature: (id, instruction, tier, cb, signal, opts)
  const opts = secondCall[5];
  expect(opts.currentLatex).toBe("\\documentclass{article}");
  expect(opts.history.length).toBeGreaterThanOrEqual(2);
  expect(opts.history[0]).toEqual({ role: "user", content: "first turn" });
});

test("renders close affordance only when onClose is provided", () => {
  const { rerender } = render(<ChatSidebar resumeId={1} onProposed={() => {}} />);
  expect(screen.queryByRole("button", { name: /close chat/i })).toBeNull();
  rerender(<ChatSidebar resumeId={1} onProposed={() => {}} onClose={() => {}} />);
  expect(screen.getByRole("button", { name: /close chat/i })).toBeInTheDocument();
});

test("preset chip prefills the input", () => {
  render(<ChatSidebar resumeId={1} onProposed={() => {}} />);
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(textarea.value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /tighten to 1 page/i }));
  expect(textarea.value).toBe("Tighten to 1 page");
});

test("onClose fires when collapse button clicked", () => {
  const onClose = vi.fn();
  render(<ChatSidebar resumeId={1} onProposed={() => {}} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: /close chat/i }));
  expect(onClose).toHaveBeenCalled();
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
