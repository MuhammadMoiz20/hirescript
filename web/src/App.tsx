import { useEffect, useState } from "react";
import Login from "./routes/Login";
import ResumeList from "./routes/ResumeList";
import { api } from "./api";

function Editor({ id, onBack }: { id: number; onBack: () => void }) {
  return (
    <div>
      <button onClick={onBack}>Back</button>
      <p>Editor {id}</p>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  useEffect(() => { api.me().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  if (authed === null) return <p>Loading…</p>;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  return openId === null
    ? <ResumeList onOpen={setOpenId} />
    : <Editor id={openId} onBack={() => setOpenId(null)} />;
}
