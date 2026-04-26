import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./routes/Login";
import ResumeList from "./routes/ResumeList";
import Editor from "./routes/Editor";
import { Jobs } from "./routes/Jobs";
import { JobsBadge } from "./components/JobsBadge";
import { api } from "./api";

function StateNav() {
  const [openId, setOpenId] = useState<number | null>(null);
  return openId === null
    ? <ResumeList onOpen={setOpenId} />
    : <Editor id={openId} onBack={() => setOpenId(null)} />;
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => { api.me().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  if (authed === null) return <p>Loading…</p>;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  return (
    <BrowserRouter>
      <div style={{ position: "fixed", top: 8, right: 12, zIndex: 1000 }}>
        <JobsBadge />
      </div>
      <Routes>
        <Route path="/jobs" element={<Jobs />} />
        <Route path="*" element={<StateNav />} />
      </Routes>
    </BrowserRouter>
  );
}
