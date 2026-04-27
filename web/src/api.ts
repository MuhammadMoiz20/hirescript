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

/** Model tier — used by the chat editor to pick a Claude model. */
export type ModelTier = "haiku" | "sonnet" | "opus";
// Backwards-compat alias for older callers (ChatSidebar). The new "Tier"
// type below is the policy object (slice 3) — distinct concept.
export type Tier = ModelTier;

/** Tier policy row — mirrors `api/app/schemas/tier.py::TierOut`. */
export type TierPolicy = {
  slug: string;
  display_name: string;
  min_fit_score: number;
  daily_cap: number;
  default_mode: "A" | "B";
  tailor_model: "sonnet-4.6" | "opus-4.7" | "haiku-4.5";
  classify_model: string;
  enabled: boolean;
  updated_at: string | null;
};

export type TierUpdate = Partial<
  Pick<TierPolicy, "daily_cap" | "default_mode" | "tailor_model" | "enabled">
>;

export async function listTiers(): Promise<TierPolicy[]> {
  const res = await fetch(`${BASE}/tiers`, { credentials: "include" });
  return jsonOrThrow<TierPolicy[]>(res);
}

export async function updateTier(slug: string, patch: TierUpdate): Promise<TierPolicy> {
  const res = await fetch(`${BASE}/tiers/${slug}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<TierPolicy>(res);
}

export type EditResult = {
  /** Null when the agent's reply was conversational and not an actual edit. */
  proposed_latex: string | null;
  page_count: number;
  enforced: boolean;
  iterations: number;
  tier_history: string[];
  removed_terms: string[];
  /** "chat" if no edit was proposed, "edit" if a proposal is attached. */
  kind?: "chat" | "edit";
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type EditCallbacks = {
  onChunk?: (text: string) => void;
  onResult?: (result: EditResult) => void;
  onError?: (message: string) => void;
};

export type EditOptions = {
  currentLatex?: string;
  history?: ChatTurn[];
};

export type ResumeOut = {
  id: number;
  name: string;
  template_id: string;
  kind: string;
  latex_source: string;
  updated_at: string;
};

export type JobDescriptionOut = {
  id: number;
  title: string;
  company: string;
  url: string | null;
  raw_text: string;
  created_at: string;
};

export type DeletePromoteRequired = {
  error: "promote_required";
  message: string;
  variant_ids: number[];
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
  opts: EditOptions = {},
): Promise<void> {
  const body: Record<string, unknown> = { instruction, tier };
  if (typeof opts.currentLatex === "string") body.current_latex = opts.currentLatex;
  if (opts.history && opts.history.length) body.history = opts.history;
  const res = await fetch(`${BASE}/resumes/${id}/edits`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
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

export type TailorEnqueueResponse = { job_id: string; batch_id: string | null };

export async function tailorToJd(
  masterId: number,
  body: TailorRequest,
): Promise<TailorEnqueueResponse> {
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

export async function deleteResume(id: number, promote?: number): Promise<void> {
  const qs = promote != null ? `?promote=${promote}` : "";
  const res = await fetch(`${BASE}/resumes/${id}${qs}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (res.status === 204) return;
  let payload: any;
  try { payload = await res.json(); } catch { payload = { message: `HTTP ${res.status}` }; }
  const detail = payload?.detail ?? payload;
  throw detail;
}

export async function duplicateResume(id: number): Promise<ResumeOut> {
  const res = await fetch(`${BASE}/resumes/${id}/duplicate`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw await res.json().catch(() => new Error(`HTTP ${res.status}`));
  return res.json();
}

export async function renameResume(id: number, name: string): Promise<ResumeOut> {
  const res = await fetch(`${BASE}/resumes/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw await res.json().catch(() => new Error(`HTTP ${res.status}`));
  return res.json();
}

export async function getJd(id: number): Promise<JobDescriptionOut> {
  const res = await fetch(`${BASE}/jds/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function downloadResumePdf(id: number, name: string): Promise<void> {
  const res = await fetch(`${BASE}/resumes/${id}/compile`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw await res.json().catch(() => new Error(`HTTP ${res.status}`));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\w.-]+/g, "_")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

// ── Profile ─────────────────────────────────────────────────────────────────

export type WorkAuth = {
  citizenships: string[];
  sponsorship_needed: Record<string, boolean>;
  relocate_to: string[];
};

export type EmploymentType = "full_time" | "contract" | "internship";

export type Position = {
  company: string;
  title: string;
  start: string;
  end: string | null;
  location: string | null;
  employment_type: EmploymentType;
  description: string | null;
};

export type Education = {
  institution: string;
  degree: string;
  field: string | null;
  start: string | null;
  end: string | null;
};

export type CompanyStage = "pre_seed" | "seed" | "series_a" | "series_b_plus" | "public";
export type WorkMode = "remote" | "hybrid" | "onsite";

export type Preferences = {
  salary_floor_usd: number | null;
  salary_target_usd: number | null;
  role_families: string[];
  dealbreakers: string[];
  company_stages: CompanyStage[];
  work_modes: WorkMode[];
  cover_letter_default: boolean;
  disclose_salary_default: boolean;
};

export type EEODefaults = {
  gender: string | null;
  race_ethnicity: string | null;
  veteran: string | null;
  disability: string | null;
};

export type Profile = {
  legal_name: string;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  links: Record<string, string>;
  work_auth: WorkAuth;
  positions: Position[];
  education: Education[];
  languages: string[];
  preferences: Preferences;
  eeo: EEODefaults;
  kill_list: string[];
};

export type ApiError = { status: number; detail?: any };

// TODO(slice-2): the codebase mixes two error conventions. New endpoints
// (profile, kb) use jsonOrThrow which throws an ApiError({status, detail}).
// Older endpoints throw plain Error(text) via req<T>(). Migrate the rest
// to jsonOrThrow before the inbox/queue surfaces in slice 2.
async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  let detail: any;
  try { detail = (await res.json()).detail; } catch { detail = await res.text().catch(() => null); }
  throw { status: res.status, detail } as ApiError;
}

export async function getProfile(): Promise<Profile> {
  const res = await fetch(`${BASE}/profile`, { credentials: "include" });
  return jsonOrThrow<Profile>(res);
}

export async function putProfile(profile: Profile): Promise<Profile> {
  const res = await fetch(`${BASE}/profile`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  return jsonOrThrow<Profile>(res);
}

// ── Onboarding chat ─────────────────────────────────────────────────────────

export type OnboardingTurn = { role: "user" | "assistant"; content: string };

export type OnboardingToolEvent =
  | { type: "tool_use"; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: Record<string, unknown> }
  | { type: "tool_error"; tool: string; error: string };

export interface OnboardingCallbacks {
  onChunk?: (text: string) => void;
  onTool?: (event: OnboardingToolEvent) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

export async function streamOnboarding(
  message: string,
  history: OnboardingTurn[],
  cb: OnboardingCallbacks = {},
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/onboarding/message`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message, history }),
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
      const evt = parseSseEvent(raw);
      if (!evt) continue;
      try {
        const data = JSON.parse(evt.data || "{}");
        if (evt.event === "text") cb.onChunk?.(data.text || "");
        else if (evt.event === "tool_use") cb.onTool?.({ type: "tool_use", tool: data.tool, input: data.input || {} });
        else if (evt.event === "tool_result") cb.onTool?.({ type: "tool_result", tool: data.tool, result: data.result || {} });
        else if (evt.event === "tool_error") cb.onTool?.({ type: "tool_error", tool: data.tool, error: data.error || "" });
        else if (evt.event === "done") cb.onDone?.();
      } catch {
        // ignore malformed frame
      }
    }
  }
}

// ── Knowledge base ──────────────────────────────────────────────────────────

export type KbSourceName = "latex_master" | "markdown";

export type KbSource = {
  source: KbSourceName | string;
  document_count: number;
  chunk_count: number;
  last_synced_at: string | null;
};

export type KbSyncResult = {
  source: string;
  document_count: number;
  chunk_count: number;
  created_or_updated?: number;
  deleted?: number;
};

export type KbDocumentItem = {
  id: number;
  source: string;
  source_id: string;
  title: string;
  fetched_at: string | null;
  chunk_count: number;
  hash: string;
};

export type KbDocumentList = {
  items: KbDocumentItem[];
  total: number;
};

export async function getKbSources(): Promise<KbSource[]> {
  const res = await fetch(`${BASE}/kb/sources`, { credentials: "include" });
  return jsonOrThrow<KbSource[]>(res);
}

export async function syncKbSource(source: string): Promise<KbSyncResult> {
  const res = await fetch(`${BASE}/kb/sources/${source}/sync`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow<KbSyncResult>(res);
}

export async function getKbDocuments(opts: { source?: string; limit?: number; offset?: number } = {}): Promise<KbDocumentList> {
  const params = new URLSearchParams();
  if (opts.source) params.set("source", opts.source);
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString();
  const res = await fetch(`${BASE}/kb/documents${qs ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow<KbDocumentList>(res);
}

export async function deleteKbDocument(id: number): Promise<void> {
  const res = await fetch(`${BASE}/kb/documents/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (res.status === 204) return;
  let detail: any;
  try { detail = (await res.json()).detail; } catch { detail = null; }
  throw { status: res.status, detail } as ApiError;
}

// ── Jobs (background queue) ────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Job {
  id: string;
  kind: string;
  status: JobStatus;
  batch_id: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TailorItem {
  jd_text: string;
  title: string;
  company: string;
  url?: string;
}

export async function enqueueTailorBatch(body: {
  resume_id: number;
  items: TailorItem[];
  deep?: boolean;
}): Promise<{ batch_id: string; job_ids: string[] }> {
  const res = await fetch(`${BASE}/jobs/tailor`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await res.json().catch(() => new Error(`HTTP ${res.status}`));
  return res.json();
}

export async function listJobs(params?: {
  status?: string;
  batch_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Job[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.batch_id) qs.set("batch_id", params.batch_id);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const query = qs.toString();
  const res = await fetch(`${BASE}/jobs${query ? `?${query}` : ""}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getJob(id: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function cancelJob(id: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${id}/cancel`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw await res.json().catch(() => new Error(`HTTP ${res.status}`));
}

// ── Postings (Inbox) ───────────────────────────────────────────────────────

export type Posting = {
  id: number;
  source: string;
  source_job_id: string;
  company: string | null;
  title: string;
  location: string | null;
  apply_url: string;
  tier: string | null;
  fit_score: number | null;
  status: string;
  ingested_at: string;
};

export type PostingDetail = Posting & {
  description_text: string;
  description_html: string | null;
  meta: Record<string, unknown>;
  canonical_key: string | null;
  classification_rationale: string | null;
};

export async function listPostings(params: {
  status?: string;
  tier?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: Posting[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.tier) qs.set("tier", params.tier);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  const query = qs.toString();
  const res = await fetch(`${BASE}/postings${query ? `?${query}` : ""}`, {
    credentials: "include",
  });
  return jsonOrThrow<{ items: Posting[]; total: number }>(res);
}

export async function getPosting(id: number): Promise<PostingDetail> {
  const res = await fetch(`${BASE}/postings/${id}`, { credentials: "include" });
  return jsonOrThrow<PostingDetail>(res);
}

export async function preparePosting(id: number): Promise<{ job_id: string; batch_id: string }> {
  const res = await fetch(`${BASE}/postings/${id}/prepare`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow<{ job_id: string; batch_id: string }>(res);
}

export async function skipPosting(id: number): Promise<{ posting_id: number; status: string }> {
  const res = await fetch(`${BASE}/postings/${id}/skip`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow<{ posting_id: number; status: string }>(res);
}

// ── Applications (Review queue) ────────────────────────────────────────────

export type Application = {
  id: number;
  posting_id: number;
  posting: Posting;
  status: string;
  mode: "A" | "B";
  cover_letter_text: string | null;
  form_payload: Record<string, unknown> | null;
  submitted_at: string | null;
  error: string | null;
  /** Slice 3: verifier verdict — null until the verify pass runs. */
  verify_ok: boolean | null;
  /** Slice 3: per-claim issues raised by the verifier. */
  verify_issues: string[];
  /** Slice 3: short rationale from the verifier. */
  verify_rationale: string | null;
};

export type ApplicationDetail = Application & {
  resume_pdf_url: string | null;
  canonical_key: string | null;
  prepared_at: string;
  confirmation_html: string | null;
  confirmation_screenshot_path: string | null;
};

export async function listApplications(params: {
  status?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: Application[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  const query = qs.toString();
  const res = await fetch(`${BASE}/applications${query ? `?${query}` : ""}`, {
    credentials: "include",
  });
  return jsonOrThrow<{ items: Application[]; total: number }>(res);
}

export async function getApplication(id: number): Promise<ApplicationDetail> {
  const res = await fetch(`${BASE}/applications/${id}`, { credentials: "include" });
  return jsonOrThrow<ApplicationDetail>(res);
}

export async function submitApplication(id: number): Promise<{ job_id: string }> {
  const res = await fetch(`${BASE}/applications/${id}/submit`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow<{ job_id: string }>(res);
}

export async function promoteToA(id: number): Promise<Application> {
  const res = await fetch(`${BASE}/applications/${id}/promote_to_A`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow<Application>(res);
}

export async function pauseA(id: number): Promise<Application> {
  const res = await fetch(`${BASE}/applications/${id}/pause_A`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow<Application>(res);
}

export async function deleteApplication(id: number): Promise<void> {
  const res = await fetch(`${BASE}/applications/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (res.status === 204) return;
  let detail: any;
  try { detail = (await res.json()).detail; } catch { detail = null; }
  throw { status: res.status, detail } as ApiError;
}

export const api = {
  getProfile,
  putProfile,
  listPostings,
  getPosting,
  preparePosting,
  skipPosting,
  listApplications,
  getApplication,
  submitApplication,
  promoteToA,
  pauseA,
  deleteApplication,
  listTiers,
  updateTier,
  getKbSources,
  syncKbSource,
  getKbDocuments,
  deleteKbDocument,
  login: (password: string) => req<{ ok: boolean }>("/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  me: () => req<{ user_id: number }>("/auth/me"),
  listResumes: () => req<Array<{ id: number; name: string; template_id: string; latex_source: string; updated_at: string }>>("/resumes"),
  createResume: (name: string, template_id: string) => req("/resumes", { method: "POST", body: JSON.stringify({ name, template_id }) }),
  getResume: (id: number) => req<{ id: number; name: string; latex_source: string }>(`/resumes/${id}`),
  updateResume: (id: number, latex_source: string) => req(`/resumes/${id}`, { method: "PUT", body: JSON.stringify({ latex_source }) }),
  async compileResume(id: number): Promise<{ pdf: Blob; pageCount: number; overflowCount: number }> {
    const res = await fetch(`${BASE}/resumes/${id}/compile`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return Promise.reject(err);
    }
    const pdf = await res.blob();
    const pageCount = parseInt(res.headers.get("x-page-count") || "0", 10) || 0;
    const overflowCount = parseInt(res.headers.get("x-overflow-count") || "0", 10) || 0;
    return { pdf, pageCount, overflowCount };
  },
  async repairResume(id: number): Promise<{
    latex_source: string;
    page_count: number;
    overflow_count: number;
    enforced: boolean;
    iterations: number;
    tier_history: string[];
  }> {
    const res = await fetch(`${BASE}/resumes/${id}/repair`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw await res.json().catch(() => new Error(`HTTP ${res.status}`));
    return res.json();
  },
  streamEdit,
  streamOnboarding,
  acceptEdit,
  tailorToJd,
  getJob,
  cancelJob,
  listGroupedResumes,
  getSections,
  putSections,
  onboardTex,
  onboardPdf,
  listVersions,
  rollback,
  deleteResume,
  duplicateResume,
  renameResume,
  getJd,
  downloadResumePdf,
};
