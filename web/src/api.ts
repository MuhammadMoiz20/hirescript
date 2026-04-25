const BASE = "/api";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error(await res.text());
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : (res.blob() as unknown as T);
}

export type Tier = "haiku" | "sonnet" | "opus";

export type EditResult = {
  proposed_latex: string;
  page_count: number;
  enforced: boolean;
  iterations: number;
  tier_history: string[];
  removed_terms: string[];
};

export type EditCallbacks = {
  onChunk?: (text: string) => void;
  onResult?: (result: EditResult) => void;
  onError?: (message: string) => void;
};

export type ResumeOut = {
  id: number;
  name: string;
  template_id: string;
  kind: string;
  latex_source: string;
  updated_at: string;
};

function parseSseEvent(raw: string): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

export async function streamEdit(
  id: number,
  instruction: string,
  tier: Tier = "haiku",
  cb: EditCallbacks = {},
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/resumes/${id}/edits`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ instruction, tier }),
    signal,
  });
  if (!res.ok || !res.body) {
    cb.onError?.(await res.text().catch(() => `HTTP ${res.status}`));
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = parseSseEvent(raw);
      if (!event) continue;
      if (event.event === "chunk") cb.onChunk?.(JSON.parse(event.data).text);
      else if (event.event === "result") cb.onResult?.(JSON.parse(event.data));
      else if (event.event === "error") cb.onError?.(JSON.parse(event.data).message);
    }
  }
}

export async function acceptEdit(id: number, proposed_latex: string): Promise<ResumeOut> {
  const res = await fetch(`${BASE}/resumes/${id}/edits/accept`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proposed_latex }),
  });
  if (!res.ok) throw await res.json().catch(() => new Error(`HTTP ${res.status}`));
  return res.json();
}

export type Variant = ResumeOut & {
  parent_id: number;
  job_description_id: number | null;
  jd_title: string | null;
  jd_company: string | null;
};

export type ResumeGroup = { master: ResumeOut; variants: Variant[] };

export type TailorRequest = {
  title: string;
  company: string;
  url?: string;
  jd_text: string;
  deep_tailor?: boolean;
};

export type TailorResponse = {
  variant: ResumeOut;
  jd_id: number;
  page_count: number;
  iterations: number;
  enforced: boolean;
  tier_history: string[];
  keywords_used: string[];
};

export async function tailorToJd(masterId: number, body: TailorRequest): Promise<TailorResponse> {
  const res = await fetch(`${BASE}/resumes/${masterId}/tailor`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await res.json().catch(() => new Error(`HTTP ${res.status}`));
  return res.json();
}

export type OnboardedResume = ResumeOut & { enforced: boolean; iterations: number; page_count: number };

export async function onboardTex(name: string, latex_source: string): Promise<OnboardedResume> {
  const res = await fetch(`${BASE}/resumes/onboard/tex`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, latex_source }),
  });
  if (!res.ok) throw await res.json().catch(() => new Error(`HTTP ${res.status}`));
  return res.json();
}

export async function onboardPdf(name: string, file: File): Promise<OnboardedResume> {
  const fd = new FormData();
  fd.append("name", name);
  fd.append("file", file);
  const res = await fetch(`${BASE}/resumes/onboard/pdf`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) throw await res.json().catch(() => new Error(`HTTP ${res.status}`));
  return res.json();
}

export async function listGroupedResumes(): Promise<ResumeGroup[]> {
  const res = await fetch(`${BASE}/resumes/grouped`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export type SectionsPayload = {
  template_id: string;
  schema: any;
  content_json: any;
};

export async function getSections(id: number): Promise<SectionsPayload> {
  const res = await fetch(`${BASE}/resumes/${id}/sections`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function putSections(id: number, content_json: any): Promise<ResumeOut> {
  const res = await fetch(`${BASE}/resumes/${id}/sections`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content_json }),
  });
  if (!res.ok) throw await res.json().catch(() => new Error(`HTTP ${res.status}`));
  return res.json();
}

export type VersionSummary = {
  id: number;
  edit_source: string;
  edit_prompt: string | null;
  page_count: number;
  created_at: string;
};

export async function listVersions(id: number): Promise<VersionSummary[]> {
  const res = await fetch(`${BASE}/resumes/${id}/versions`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function rollback(id: number, versionId: number): Promise<ResumeOut> {
  const res = await fetch(`${BASE}/resumes/${id}/versions/${versionId}/rollback`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  login: (password: string) => req<{ ok: boolean }>("/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  me: () => req<{ user_id: number }>("/auth/me"),
  listResumes: () => req<Array<{ id: number; name: string; template_id: string; latex_source: string; updated_at: string }>>("/resumes"),
  createResume: (name: string, template_id: string) => req("/resumes", { method: "POST", body: JSON.stringify({ name, template_id }) }),
  getResume: (id: number) => req<{ id: number; name: string; latex_source: string }>(`/resumes/${id}`),
  updateResume: (id: number, latex_source: string) => req(`/resumes/${id}`, { method: "PUT", body: JSON.stringify({ latex_source }) }),
  compileResume: (id: number) => fetch(`${BASE}/resumes/${id}/compile`, { method: "POST", credentials: "include" }).then(r => r.ok ? r.blob() : r.json().then(j => Promise.reject(j))),
  streamEdit,
  acceptEdit,
  tailorToJd,
  listGroupedResumes,
  getSections,
  putSections,
  onboardTex,
  onboardPdf,
  listVersions,
  rollback,
};
