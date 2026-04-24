import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Login from "./Login";
import { vi } from "vitest";

vi.mock("../api", () => ({ api: { login: vi.fn().mockResolvedValue({ ok: true }) } }));

test("submits password and calls api.login", async () => {
  const { api } = await import("../api");
  render(<Login onSuccess={() => {}} />);
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret" } });
  fireEvent.click(screen.getByRole("button", { name: /log in/i }));
  await waitFor(() => expect(api.login).toHaveBeenCalledWith("secret"));
});
