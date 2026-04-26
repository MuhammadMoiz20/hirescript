import { useEffect, useState } from "react";
import Login from "./routes/Login";
import ResumeList from "./routes/ResumeList";
import Editor from "./routes/Editor";
import Profile from "./routes/Profile";
import Knowledge from "./routes/Knowledge";
import Button from "./components/ui/Button";
import { api } from "./api";

type View = "list" | "editor" | "profile" | "knowledge";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [view, setView] = useState<View>("list");
  useEffect(() => { api.me().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  if (authed === null) return <p>Loading…</p>;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  function goList() {
    setOpenId(null);
    setView("list");
  }

  if (view === "profile") {
    return (
      <Shell active="profile" onNav={(v) => setView(v)} onHome={goList}>
        <Profile onBack={goList} />
      </Shell>
    );
  }
  if (view === "knowledge") {
    return (
      <Shell active="knowledge" onNav={(v) => setView(v)} onHome={goList}>
        <Knowledge onBack={goList} />
      </Shell>
    );
  }
  if (openId !== null) {
    return <Editor id={openId} onBack={() => setOpenId(null)} />;
  }
  return (
    <Shell active="list" onNav={(v) => setView(v)} onHome={goList}>
      <ResumeList onOpen={(id) => { setOpenId(id); setView("list"); }} />
    </Shell>
  );
}

function Shell({
  children,
  active,
  onNav,
  onHome,
}: {
  children: React.ReactNode;
  active: View;
  onNav: (v: View) => void;
  onHome: () => void;
}) {
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          background: "var(--paper)",
          borderBottom: "1px solid var(--rule)",
          flexShrink: 0,
        }}
      >
        <Button
          size="sm"
          variant={active === "list" ? "subtle" : "ghost"}
          onClick={() => {
            onHome();
            onNav("list");
          }}
        >
          Resumes
        </Button>
        <Button
          size="sm"
          variant={active === "profile" ? "subtle" : "ghost"}
          onClick={() => onNav("profile")}
        >
          Profile
        </Button>
        <Button
          size="sm"
          variant={active === "knowledge" ? "subtle" : "ghost"}
          onClick={() => onNav("knowledge")}
        >
          Knowledge
        </Button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
