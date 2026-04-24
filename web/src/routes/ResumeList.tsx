import { useEffect, useState } from "react";
import { api } from "../api";

type Resume = { id: number; name: string; template_id: string; updated_at: string };

export default function ResumeList({ onOpen }: { onOpen: (id: number) => void }) {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [name, setName] = useState("");
  async function refresh() { setResumes(await api.listResumes()); }
  useEffect(() => { refresh(); }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createResume(name, "jakes");
    setName("");
    refresh();
  }
  return (
    <div>
      <h1>Resumes</h1>
      <form onSubmit={create}>
        <input placeholder="New resume name" value={name} onChange={e => setName(e.target.value)} />
        <button type="submit">Create from Jake's</button>
      </form>
      <ul>
        {resumes.map(r => <li key={r.id}><button onClick={() => onOpen(r.id)}>{r.name}</button></li>)}
      </ul>
    </div>
  );
}
