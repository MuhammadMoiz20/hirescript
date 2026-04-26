import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelJob, enqueueTailorBatch, getJob, listJobs, type Job } from "./api";

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    calls.push({ url: u, init });
    return impl(u, init);
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { fn, calls };
}

const sampleJob: Job = {
  id: "job-1",
  kind: "tailor",
  status: "queued",
  batch_id: "batch-1",
  payload: { resume_id: 1 },
  result: null,
  attempts: 0,
  created_at: "2026-04-25T00:00:00Z",
  started_at: null,
  finished_at: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("enqueueTailorBatch", () => {
  it("posts JSON body and returns parsed response", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({ batch_id: "batch-1", job_ids: ["job-1", "job-2"] }),
    );
    const out = await enqueueTailorBatch({
      resume_id: 7,
      items: [{ jd_text: "jd", title: "Eng", company: "Acme" }],
      deep: true,
    });
    expect(out).toEqual({ batch_id: "batch-1", job_ids: ["job-1", "job-2"] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/jobs/tailor");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      resume_id: 7,
      items: [{ jd_text: "jd", title: "Eng", company: "Acme" }],
      deep: true,
    });
  });

  it("throws on non-2xx", async () => {
    mockFetch(() => jsonResponse({ detail: "bad" }, { status: 400 }));
    await expect(
      enqueueTailorBatch({ resume_id: 1, items: [] }),
    ).rejects.toBeDefined();
  });
});

describe("listJobs", () => {
  it("requests /api/jobs with no query string when no params", async () => {
    const { calls } = mockFetch(() => jsonResponse({ items: [sampleJob], total: 1 }));
    const out = await listJobs();
    expect(out.total).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(calls[0].url).toBe("/api/jobs");
  });

  it("builds query string with all params", async () => {
    const { calls } = mockFetch(() => jsonResponse({ items: [], total: 0 }));
    await listJobs({ status: "queued,running", batch_id: "b1", limit: 50, offset: 10 });
    expect(calls[0].url).toBe(
      "/api/jobs?status=queued%2Crunning&batch_id=b1&limit=50&offset=10",
    );
  });

  it("omits undefined params", async () => {
    const { calls } = mockFetch(() => jsonResponse({ items: [], total: 0 }));
    await listJobs({ status: "queued" });
    expect(calls[0].url).toBe("/api/jobs?status=queued");
  });

  it("throws on non-2xx", async () => {
    mockFetch(() => new Response("err", { status: 500 }));
    await expect(listJobs()).rejects.toThrow(/HTTP 500/);
  });
});

describe("getJob", () => {
  it("requests /api/jobs/{id}", async () => {
    const { calls } = mockFetch(() => jsonResponse(sampleJob));
    const out = await getJob("job-1");
    expect(out.id).toBe("job-1");
    expect(calls[0].url).toBe("/api/jobs/job-1");
  });

  it("throws on 404", async () => {
    mockFetch(() => new Response("not found", { status: 404 }));
    await expect(getJob("missing")).rejects.toThrow(/HTTP 404/);
  });
});

describe("cancelJob", () => {
  it("posts to /api/jobs/{id}/cancel", async () => {
    const { calls } = mockFetch(() => jsonResponse({ ok: true }));
    await cancelJob("job-1");
    expect(calls[0].url).toBe("/api/jobs/job-1/cancel");
    expect(calls[0].init?.method).toBe("POST");
  });

  it("throws on 409 conflict", async () => {
    mockFetch(() => jsonResponse({ detail: "already terminal" }, { status: 409 }));
    await expect(cancelJob("job-1")).rejects.toBeDefined();
  });
});
