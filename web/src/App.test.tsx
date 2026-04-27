import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

// Mock the api module so App's auth probe + Overview's data load resolve cleanly.
const mockApi = vi.hoisted(() => ({
  me: vi.fn(),
  listResumes: vi.fn(),
  listPostings: vi.fn(),
  listApplications: vi.fn(),
}));
const mockListJobs = vi.hoisted(() => vi.fn());

vi.mock("./api", () => ({
  api: mockApi,
  listJobs: mockListJobs,
}));

import App from "./App";
import { ThemeProvider } from "./components/ThemeProvider";

beforeEach(() => {
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  mockListJobs.mockReset();
  mockApi.me.mockResolvedValue({ user_id: 1 });
  mockApi.listResumes.mockResolvedValue([]);
  mockApi.listPostings.mockResolvedValue({ items: [], total: 0 });
  mockApi.listApplications.mockResolvedValue({ items: [], total: 0 });
  mockListJobs.mockResolvedValue({ items: [], total: 0 });
  // Set the URL away from /jobs so the default StateApp route mounts.
  window.history.replaceState({}, "", "/");
});

function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

test("renders the Suite TopBar and NavRail in default authenticated state", async () => {
  renderApp();

  // Wait for auth probe to flip from loading to authed.
  await waitFor(() => expect(mockApi.me).toHaveBeenCalled());

  // TopBar wordmark
  const topbar = await waitFor(() => {
    const el = document.querySelector('[data-component="suite-topbar"]');
    if (!el) throw new Error("topbar not found");
    return el as HTMLElement;
  });
  expect(topbar).toBeInTheDocument();
  expect(topbar).toHaveTextContent("HireScript");

  // NavRail with grouped eyebrows
  const navrail = await screen.findByLabelText("Primary navigation");
  expect(navrail).toBeInTheDocument();
  expect(navrail).toHaveAttribute("data-component", "suite-navrail");
  expect(navrail).toHaveTextContent("Per-job");
  expect(navrail).toHaveTextContent("Mass-apply");
  expect(navrail).toHaveTextContent("Library");
  expect(navrail).toHaveTextContent("Inbox");
  expect(navrail).toHaveTextContent("Settings");

  // Overview is the default landing pane.
  await screen.findByTestId("overview-route");
});
