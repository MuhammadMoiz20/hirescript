import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import OnboardingChat from "./OnboardingChat";

vi.mock("../api", () => ({
  api: {
    streamOnboarding: vi.fn(),
    getProfile: vi.fn(async () => ({
      legal_name: "",
      email: "unset@example.com",
    })),
  },
}));

test("renders existing history", async () => {
  render(
    <OnboardingChat
      initialHistory={[
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ]}
    />,
  );
  expect(screen.getByText("hi")).toBeInTheDocument();
  expect(screen.getByText("hello")).toBeInTheDocument();
});

test("sending a message appends user turn and streams assistant tokens", async () => {
  const { api } = await import("../api");
  (api.streamOnboarding as any).mockImplementationOnce(
    async (_msg: string, _hist: any, cb: any) => {
      cb.onChunk("hello");
      cb.onChunk(" world");
    },
  );
  render(<OnboardingChat />);
  const input = screen.getByLabelText(/message/i);
  fireEvent.change(input, { target: { value: "Tell me about you" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(screen.getByText("Tell me about you")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText("hello world")).toBeInTheDocument());
});

test("on completion calls getProfile to refresh", async () => {
  const { api } = await import("../api");
  (api.streamOnboarding as any).mockImplementationOnce(
    async (_msg: string, _hist: any, cb: any) => {
      cb.onChunk("ok");
    },
  );
  (api.getProfile as any).mockClear();

  render(<OnboardingChat />);
  fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "hi" } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(api.getProfile).toHaveBeenCalled());
});
