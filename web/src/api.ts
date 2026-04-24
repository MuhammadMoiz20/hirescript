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

export const api = {
  login: (password: string) => req<{ ok: boolean }>("/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  me: () => req<{ user_id: number }>("/auth/me"),
  listResumes: () => req<Array<{ id: number; name: string; template_id: string; latex_source: string; updated_at: string }>>("/resumes"),
  createResume: (name: string, template_id: string) => req("/resumes", { method: "POST", body: JSON.stringify({ name, template_id }) }),
  getResume: (id: number) => req<{ id: number; name: string; latex_source: string }>(`/resumes/${id}`),
  updateResume: (id: number, latex_source: string) => req(`/resumes/${id}`, { method: "PUT", body: JSON.stringify({ latex_source }) }),
  compileResume: (id: number) => fetch(`${BASE}/resumes/${id}/compile`, { method: "POST", credentials: "include" }).then(r => r.ok ? r.blob() : r.json().then(j => Promise.reject(j))),
};
