import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import Login from "./routes/Login";
import ResumeList from "./routes/ResumeList";
import Editor from "./routes/Editor";
import Profile from "./routes/Profile";
import Knowledge from "./routes/Knowledge";
import OnboardingChat from "./routes/OnboardingChat";
import { Jobs } from "./routes/Jobs";
import { JobsBadge } from "./components/JobsBadge";
import Button from "./components/ui/Button";
import { api } from "./api";

type View = "list" | "editor" | "profile" | "knowledge" | "onboarding" | "jobs";

function StateApp() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [view, setView] = useState<View>("list");
  const navigate = useNavigate();

  function goList() {
    setOpenId(null);
    setView("list");
  }

  function onNav(v: View) {
    if (v === "jobs") {
      navigate("/jobs");
      return;
    }
    setView(v);
  }

  if (view === "profile") {
    return (
      <Shell active="profile" onNav={onNav} onHome={goList}>
        <Profile onBack={goList} />
      </Shell>
    );
  }
  if (view === "knowledge") {
    return (
      <Shell active="knowledge" onNav={onNav} onHome={goList}>
        <Knowledge onBack={goList} />
      </Shell>
    );
  }
  if (view === "onboarding") {
    return (
      <Shell active="onboarding" onNav={onNav} onHome={goList}>
        <OnboardingChat onBack={goList} />
      </Shell>
    );
  }
  if (openId !== null) {
    return <Editor id={openId} onBack={() => setOpenId(null)} />;
  }
  return (
    <Shell active="list" onNav={onNav} onHome={goList}>
      <ResumeList onOpen={(id) => { setOpenId(id); setView("list"); }} />
    </Shell>
  );
}

function JobsRoute() {
  const navigate = useNavigate();
  return (
    <Shell active="jobs" onNav={(v) => {
      if (v === "jobs") return;
      navigate("/");
    }} onHome={() => navigate("/")}>
      <Jobs />
    </Shell>
  );
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
        <Route path="/jobs" element={<JobsRoute />} />
        <Route path="*" element={<StateApp />} />
      </Routes>
    </BrowserRouter>
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
        <Button
          size="sm"
          variant={active === "onboarding" ? "subtle" : "ghost"}
          onClick={() => onNav("onboarding")}
        >
          Onboarding
        </Button>
        <Button
          size="sm"
          variant={active === "jobs" ? "subtle" : "ghost"}
          onClick={() => onNav("jobs")}
        >
          Jobs
        </Button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
