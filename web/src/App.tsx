import { useEffect, useState } from "react";
import Login from "./routes/Login";
import ResumeList from "./routes/ResumeList";
import Editor from "./routes/Editor";
import { api } from "./api";

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
