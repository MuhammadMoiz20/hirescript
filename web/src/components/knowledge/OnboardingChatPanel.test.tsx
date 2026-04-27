import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";
import OnboardingChatPanel from "./OnboardingChatPanel";

vi.mock("../../api", () => ({
  api: {
    streamOnboarding: vi.fn(),
    getProfile: vi.fn(async () => ({
      legal_name: "",
      email: null,
    })),
  },
}));

function noop() {}

test("renders bundle empty-state copy when there is no history", () => {
  render(
    <OnboardingChatPanel
      collapsed={false}
      onToggleCollapsed={noop}
      initialHistory={[]}
    />,
  );
  expect(
    screen.getByText(/send a message to start/i),
  ).toBeInTheDocument();
});

test("renders existing history when expanded", async () => {
  render(
    <OnboardingChatPanel
      collapsed={false}
      onToggleCollapsed={noop}
      initialHistory={[
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ]}
    />,
  );
  expect(screen.getByText("hi")).toBeInTheDocument();
  expect(screen.getByText("hello")).toBeInTheDocument();
});

test("collapsed state renders only an open handle and hides chat UI", () => {
  render(
    <OnboardingChatPanel
      collapsed={true}
      onToggleCollapsed={noop}
      initialHistory={[{ role: "user", content: "hi" }]}
    />,
  );
  expect(screen.getByLabelText(/open onboarding chat/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/^message$/i)).not.toBeInTheDocument();
  expect(screen.queryByText("hi")).not.toBeInTheDocument();
  const panel = screen.getByLabelText(/onboarding chat \(collapsed\)/i);
  expect(panel).toHaveAttribute("data-collapsed", "true");
});

test("clicking the collapse/open buttons fires onToggleCollapsed", () => {
  function Harness() {
    const [collapsed, setCollapsed] = useState(false);
    return (
      <OnboardingChatPanel
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />
    );
  }
  render(<Harness />);
  // Expanded → click collapse
  fireEvent.click(screen.getByLabelText(/collapse onboarding chat/i));
  expect(screen.getByLabelText(/open onboarding chat/i)).toBeInTheDocument();
  // Collapsed → click open
  fireEvent.click(screen.getByLabelText(/open onboarding chat/i));
  expect(screen.getByLabelText(/collapse onboarding chat/i)).toBeInTheDocument();
});

test("sending a message appends user turn and streams assistant tokens", async () => {
  const { api } = await import("../../api");
  (api.streamOnboarding as any).mockImplementationOnce(
    async (_msg: string, _hist: any, cb: any) => {
      cb.onChunk("hello");
      cb.onChunk(" world");
    },
  );
  render(<OnboardingChatPanel collapsed={false} onToggleCollapsed={noop} />);
  const input = screen.getByLabelText(/message/i);
  fireEvent.change(input, { target: { value: "Tell me about you" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(screen.getByText("Tell me about you")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText("hello world")).toBeInTheDocument());
});

test("on completion calls getProfile to refresh", async () => {
  const { api } = await import("../../api");
  (api.streamOnboarding as any).mockImplementationOnce(
    async (_msg: string, _hist: any, cb: any) => {
      cb.onChunk("ok");
    },
  );
  (api.getProfile as any).mockClear();

  render(<OnboardingChatPanel collapsed={false} onToggleCollapsed={noop} />);
  fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "hi" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(api.getProfile).toHaveBeenCalled());
});
