/**
 * Tiers route tests — slice 3 wires this surface to the live `tiers` table.
 *
 * Each card is editable: daily_cap (blur), default_mode (toggle), tailor_model
 * (select), enabled (toggle). PATCH fires per change with optimistic update +
 * rollback on failure. The "Slice 3 will introduce…" banner and the readonly
 * data-testid `tiers-readonly-banner` block are gone.
 */
import { render, screen, within, fireEvent, waitFor, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import Tiers from "./Tiers";
import type { TierPolicy } from "../api";

function tier(over: Partial<TierPolicy> = {}): TierPolicy {
  return {
    slug: "targeted",
    display_name: "Targeted",
    min_fit_score: 65,
    daily_cap: 20,
    default_mode: "A",
    tailor_model: "sonnet-4.6",
    classify_model: "haiku-4.5",
    enabled: true,
    updated_at: "2026-04-26T12:00:00Z",
    ...over,
  };
}

const FOUR_TIERS: TierPolicy[] = [
  tier({ slug: "dream",    display_name: "Dream",    min_fit_score: 85, daily_cap: 999, default_mode: "B", tailor_model: "opus-4.7" }),
  tier({ slug: "targeted", display_name: "Targeted", min_fit_score: 65, daily_cap: 20,  default_mode: "A", tailor_model: "sonnet-4.6" }),
  tier({ slug: "wide_net", display_name: "Wide net", min_fit_score: 40, daily_cap: 50,  default_mode: "A", tailor_model: "sonnet-4.6" }),
  tier({ slug: "skip",     display_name: "Skip",     min_fit_score: 0,  daily_cap: 0,   default_mode: "B", tailor_model: "haiku-4.5" }),
];

const realFetch = global.fetch;

function mockTiers(rows: TierPolicy[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/tiers") && (!init || !init.method || init.method === "GET")) {
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (/\/api\/tiers\/[^/]+$/.test(url) && init?.method === "PATCH") {
      const slug = url.split("/").pop()!;
      const patch = JSON.parse((init.body as string) || "{}");
      const existing = rows.find((r) => r.slug === slug)!;
      const updated = { ...existing, ...patch, updated_at: new Date().toISOString() };
      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unmocked fetch: ${init?.method || "GET"} ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("Tiers route — wired to backend", () => {
  test("renders header without the slice-3 readonly banner", async () => {
    mockTiers(FOUR_TIERS);
    render(<Tiers />);
    await screen.findByTestId("tier-card-dream");
    expect(screen.queryByTestId("tiers-readonly-banner")).not.toBeInTheDocument();
    expect(screen.queryByText(/coming in slice 3/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/slice 3 will introduce/i)).not.toBeInTheDocument();
  });

  test("fetches /api/tiers on mount and renders all four cards", async () => {
    const fetchMock = mockTiers(FOUR_TIERS);
    render(<Tiers />);
    for (const t of FOUR_TIERS) {
      const card = await screen.findByTestId(`tier-card-${t.slug}`);
      expect(within(card).getByText(new RegExp(`min fit score:\\s*${t.min_fit_score}`, "i"))).toBeInTheDocument();
    }
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/tiers$/),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  test("editing daily_cap PATCHes the tier on blur", async () => {
    const fetchMock = mockTiers(FOUR_TIERS);
    render(<Tiers />);
    const card = await screen.findByTestId("tier-card-targeted");
    const cap = within(card).getByLabelText(/daily cap/i) as HTMLInputElement;
    fireEvent.change(cap, { target: { value: "30" } });
    fireEvent.blur(cap);
    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patches.length).toBe(1);
      const [url, init] = patches[0];
      expect(String(url)).toMatch(/\/api\/tiers\/targeted$/);
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ daily_cap: 30 });
    });
  });

  test("daily_cap=0 shows 'A-mode disabled' hint", async () => {
    mockTiers(FOUR_TIERS);
    render(<Tiers />);
    const card = await screen.findByTestId("tier-card-skip");
    expect(within(card).getByText(/a-mode disabled/i)).toBeInTheDocument();
  });

  test("toggling enabled PATCHes immediately", async () => {
    const fetchMock = mockTiers(FOUR_TIERS);
    render(<Tiers />);
    const card = await screen.findByTestId("tier-card-targeted");
    const enabled = within(card).getByLabelText(/^enabled$/i) as HTMLInputElement;
    fireEvent.click(enabled);
    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patches.length).toBe(1);
      expect(JSON.parse((patches[0][1] as RequestInit).body as string)).toEqual({ enabled: false });
    });
  });

  test("PATCH 422 rolls back the optimistic value and shows an inline error", async () => {
    let calls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/tiers") && (!init || !init.method || init.method === "GET")) {
        return new Response(JSON.stringify(FOUR_TIERS), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ detail: "invalid daily_cap" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("Unmocked");
    }) as unknown as typeof fetch;

    render(<Tiers />);
    const card = await screen.findByTestId("tier-card-targeted");
    const cap = within(card).getByLabelText(/daily cap/i) as HTMLInputElement;
    expect(cap.value).toBe("20");
    fireEvent.change(cap, { target: { value: "999999" } });
    fireEvent.blur(cap);
    await waitFor(() => {
      expect(within(card).getByRole("alert")).toHaveTextContent(/invalid daily_cap/i);
    });
    // Rolled back to original value.
    expect(cap.value).toBe("20");
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test("renders an empty state when the backend returns no tiers", async () => {
    mockTiers([]);
    render(<Tiers />);
    await waitFor(() =>
      expect(screen.getByTestId("tiers-empty")).toBeInTheDocument(),
    );
  });

  test("shows updated_at when present", async () => {
    mockTiers([
      tier({ slug: "targeted", updated_at: "2026-04-26T12:34:56Z" }),
    ]);
    render(<Tiers />);
    const card = await screen.findByTestId("tier-card-targeted");
    expect(within(card).getByText(/updated/i)).toBeInTheDocument();
  });

  test("changing tailor_model PATCHes with the new value", async () => {
    const fetchMock = mockTiers(FOUR_TIERS);
    render(<Tiers />);
    const card = await screen.findByTestId("tier-card-targeted");
    const select = within(card).getByLabelText(/tailor model/i) as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: "opus-4.7" } });
    });
    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patches.length).toBe(1);
      expect(JSON.parse((patches[0][1] as RequestInit).body as string)).toEqual({
        tailor_model: "opus-4.7",
      });
    });
  });
});
