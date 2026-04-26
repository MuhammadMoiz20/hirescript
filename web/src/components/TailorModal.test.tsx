import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi, beforeEach, afterEach } from "vitest";
import TailorModal from "./TailorModal";

// --- EventSource mock --------------------------------------------------------

type Listener = (ev: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  onerror: ((this: EventSource, ev: Event) => any) | null = null;
  private listeners: Record<string, Listener[]> = {};
  closed = false;
  // EventSource constants
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    this.readyState = MockEventSource.OPEN;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, cb: Listener) {
    (this.listeners[event] ||= []).push(cb);
  }

  removeEventListener(event: string, cb: Listener) {
    this.listeners[event] = (this.listeners[event] || []).filter(l => l !== cb);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
    this.closed = true;
  }

  emit(event: string, data: any) {
    const ev = new MessageEvent(event, { data: JSON.stringify(data) });
    (this.listeners[event] || []).forEach(l => l(ev));
  }
}

// Attach static constants on instances too (the component reads `EventSource.CLOSED`).
(MockEventSource.prototype as any).CONNECTING = 0;
(MockEventSource.prototype as any).OPEN = 1;
(MockEventSource.prototype as any).CLOSED = 2;

// --- API mock ---------------------------------------------------------------

vi.mock("../api", () => ({
  api: {
    tailorToJd: vi.fn(async () => ({ job_id: "job-abc", batch_id: null })),
    getJob: vi.fn(async () => ({
      id: "job-abc",
      kind: "tailor",
      status: "succeeded",
      batch_id: null,
      payload: {},
      result: {
        variant_id: 5,
        jd_id: 1,
        page_count: 1,
        iterations: 0,
        enforced: true,
        tier_history: [],
        keywords_used: ["python"],
      },
      attempts: 1,
      created_at: "",
      started_at: "",
      finished_at: "",
    })),
  },
}));

beforeEach(() => {
  MockEventSource.instances = [];
  (globalThis as any).EventSource = MockEventSource;
});

afterEach(() => {
  vi.clearAllMocks();
});

function setup(extra = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<TailorModal masterId={1} masterName="Master" open={true} onClose={onClose} onCreated={onCreated} {...extra} />);
  return { onClose, onCreated };
}

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "SWE" } });
  fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "Acme" } });
  fireEvent.change(screen.getByLabelText(/job description/i), { target: { value: "JD body" } });
}

test("renders nothing when open=false", () => {
  const { container } = render(<TailorModal masterId={1} masterName="M" open={false} onClose={() => {}} onCreated={() => {}} />);
  expect(container.firstChild).toBeNull();
});

test("submit disabled until required fields filled", () => {
  setup();
  expect(screen.getByRole("button", { name: /^tailor$/i })).toBeDisabled();
  fillRequired();
  expect(screen.getByRole("button", { name: /^tailor$/i })).not.toBeDisabled();
});

test("posts tailor, subscribes to SSE, and finishes on done event", async () => {
  const { onCreated } = setup();
  fillRequired();
  fireEvent.click(screen.getByRole("button", { name: /^tailor$/i }));

  const { api } = await import("../api");
  await waitFor(() =>
    expect(api.tailorToJd).toHaveBeenCalledWith(1, expect.objectContaining({ company: "Acme" })),
  );
  await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
  const es = MockEventSource.instances[0];
  expect(es.url).toBe("/api/jobs/job-abc/events");

  // Phase event drives the status text.
  act(() => {
    es.emit("phase", { phase: "keywords_done", message: null, data: { count: 5 } });
  });
  expect(screen.getByRole("status").textContent).toMatch(/keywords_done/);

  // Terminal `done` triggers getJob + onCreated.
  act(() => {
    es.emit("done", {});
  });
  await waitFor(() => expect(api.getJob).toHaveBeenCalledWith("job-abc"));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(es.closed).toBe(true);
});

test("shows not_one_page error from failed terminal event", async () => {
  const { api } = await import("../api");
  (api.getJob as any).mockResolvedValueOnce({
    id: "job-abc",
    kind: "tailor",
    status: "failed",
    batch_id: null,
    payload: {},
    result: { error: "not_one_page", page_count: 2, iterations: 4 },
    attempts: 1,
    created_at: "",
    started_at: null,
    finished_at: "",
  });
  setup();
  fillRequired();
  fireEvent.click(screen.getByRole("button", { name: /^tailor$/i }));
  await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
  const es = MockEventSource.instances[0];
  act(() => {
    es.emit("failed", {});
  });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/2 page/));
  expect(es.closed).toBe(true);
});

test("shows error when POST fails with not_one_page detail", async () => {
  const { api } = await import("../api");
  (api.tailorToJd as any).mockRejectedValueOnce({
    detail: { error: "not_one_page", page_count: 2, iterations: 4 },
  });
  setup();
  fillRequired();
  fireEvent.click(screen.getByRole("button", { name: /^tailor$/i }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/2 page/));
  expect(MockEventSource.instances.length).toBe(0);
});

test("cancelled terminal event surfaces a message and closes the stream", async () => {
  setup();
  fillRequired();
  fireEvent.click(screen.getByRole("button", { name: /^tailor$/i }));
  await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
  const es = MockEventSource.instances[0];
  act(() => {
    es.emit("cancelled", {});
  });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/cancelled/i));
  expect(es.closed).toBe(true);
});

test("Cancel button calls onClose and closes the stream if open", async () => {
  const { onClose } = setup();
  fillRequired();
  fireEvent.click(screen.getByRole("button", { name: /^tailor$/i }));
  await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
  // Cancel button is disabled while busy; simulate done so it re-enables.
  const es = MockEventSource.instances[0];
  act(() => {
    es.emit("done", {});
  });
  await waitFor(() => expect(es.closed).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onClose).toHaveBeenCalled();
});

test("closes EventSource on unmount", async () => {
  const { unmount } = render(
    <TailorModal masterId={1} masterName="M" open={true} onClose={() => {}} onCreated={() => {}} />,
  );
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "x" } });
  fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "y" } });
  fireEvent.change(screen.getByLabelText(/job description/i), { target: { value: "z" } });
  fireEvent.click(screen.getByRole("button", { name: /^tailor$/i }));
  await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
  const es = MockEventSource.instances[0];
  unmount();
  expect(es.closed).toBe(true);
});
