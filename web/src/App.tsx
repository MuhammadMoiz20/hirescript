import { useEffect, useState } from "react";
import Login from "./routes/Login";
import { api } from "./api";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => { api.me().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  if (authed === null) return <p>Loading…</p>;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  return <div>Logged in (editor goes here)</div>;
}
