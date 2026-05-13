import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  enforceOneLine,
  onboardPdf,
  onboardTex,
  tailorToJd,
} from "./api";

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function mockFetch(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    calls.push({ url: u, init });
    return impl(u, init);
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { fn, calls };
}

function parseBody(init?: RequestInit): any {
  if (!init || typeof init.body !== "string") return null;
  return JSON.parse(init.body);
}

const sampleResume = {
  id: 1,
  name: "R",
  template_id: "harvard",
  kind: "master",
  latex_source: "",
  updated_at: "2026-05-13T00:00:00Z",
  one_line_per_bullet: false,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createResume one_line_per_bullet", () => {
  it("includes one_line_per_bullet=true when set", async () => {
    const { calls } = mockFetch(() => jsonResponse(sampleResume));
    await api.createResume("Resume A", "harvard", true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/resumes");
    expect(parseBody(calls[0].init)).toEqual({
      name: "Resume A",
      template_id: "harvard",
      one_line_per_bullet: true,
    });
  });

  it("omits one_line_per_bullet when not provided", async () => {
    const { calls } = mockFetch(() => jsonResponse(sampleResume));
    await api.createResume("Resume A", "harvard");
    expect(parseBody(calls[0].init)).toEqual({
      name: "Resume A",
      template_id: "harvard",
    });
  });
});

describe("onboardTex one_line_per_bullet", () => {
  it("includes flag when provided", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({ ...sampleResume, enforced: true, iterations: 1, page_count: 1 }),
    );
    await onboardTex("Master", "\\documentclass{article}", true);
    expect(calls[0].url).toBe("/api/resumes/onboard/tex");
    expect(parseBody(calls[0].init)).toEqual({
      name: "Master",
      latex_source: "\\documentclass{article}",
      one_line_per_bullet: true,
    });
  });

  it("omits flag when not provided", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({ ...sampleResume, enforced: true, iterations: 1, page_count: 1 }),
    );
    await onboardTex("Master", "src");
    expect(parseBody(calls[0].init)).toEqual({
      name: "Master",
      latex_source: "src",
    });
  });
});

describe("onboardPdf one_line_per_bullet", () => {
  it("appends one_line_per_bullet to FormData when provided", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({ ...sampleResume, enforced: true, iterations: 1, page_count: 1 }),
    );
    const file = new File([new Uint8Array([1, 2, 3])], "r.pdf", {
      type: "application/pdf",
    });
    await onboardPdf("Master", file, true);
    expect(calls[0].url).toBe("/api/resumes/onboard/pdf");
    const fd = calls[0].init?.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get("name")).toBe("Master");
    expect(fd.get("one_line_per_bullet")).toBe("true");
  });

  it("omits one_line_per_bullet from FormData when not provided", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({ ...sampleResume, enforced: true, iterations: 1, page_count: 1 }),
    );
    const file = new File([new Uint8Array([1])], "r.pdf", { type: "application/pdf" });
    await onboardPdf("Master", file);
    const fd = calls[0].init?.body as FormData;
    expect(fd.has("one_line_per_bullet")).toBe(false);
  });
});

describe("tailorToJd one_line_per_bullet", () => {
  it("passes null in body to inherit from master", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({ job_id: "j1", batch_id: null }),
    );
    await tailorToJd(7, {
      title: "SWE",
      company: "Acme",
      jd_text: "build things",
      one_line_per_bullet: null,
    });
    expect(calls[0].url).toBe("/api/resumes/7/tailor");
    expect(parseBody(calls[0].init)).toMatchObject({
      one_line_per_bullet: null,
    });
  });

  it("passes true when explicitly set", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({ job_id: "j1", batch_id: null }),
    );
    await tailorToJd(7, {
      title: "SWE",
      company: "Acme",
      jd_text: "JD",
      one_line_per_bullet: true,
    });
    expect(parseBody(calls[0].init)).toMatchObject({
      one_line_per_bullet: true,
    });
  });
});

describe("enforceOneLine", () => {
  it("POSTs to /resumes/{id}/enforce_one_line with credentials", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({ ...sampleResume, id: 42, one_line_per_bullet: true }),
    );
    const out = await enforceOneLine(123);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/resumes/123/enforce_one_line");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.credentials).toBe("include");
    expect(out.id).toBe(42);
    expect(out.one_line_per_bullet).toBe(true);
  });
});
