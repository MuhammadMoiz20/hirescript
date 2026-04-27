import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import Login from "./routes/Login";
import ResumeList from "./routes/ResumeList";
import Editor from "./routes/Editor";
import Knowledge, { type KnowledgeTab } from "./routes/Knowledge";
import Inbox from "./routes/Inbox";
import Queue from "./routes/Queue";
import { Jobs } from "./routes/Jobs";
import Overview from "./routes/Overview";
import HistoryMassApply from "./routes/HistoryMassApply";
import Dashboard from "./routes/Dashboard";
import Tiers from "./routes/Tiers";
import Settings from "./routes/Settings";
import TopBar from "./components/suite/TopBar";
import NavRail, { type NavKey } from "./components/suite/NavRail";
import CommandPalette, { type CommandItem } from "./components/suite/CommandPalette";
import { useTheme } from "./components/ThemeProvider";
import { api, listJobs } from "./api";

/**
 * View union — existing app states plus Suite shell surfaces.
 * `overview` is the default landing pane (Overview from T9). The new
 * `dashboard | tiers | settings | history-massapply` values render
 * placeholders here and are wired in Phase C/E.
 */
export type View =
  | "overview"
  | "list"
  | "editor"
  | "knowledge"
  | "inbox"
  | "applications"
  | "jobs"
  | "dashboard"
  | "tiers"
  | "settings"
  | "history-massapply";

/** Map current View → NavKey for highlighting NavRail. `null` = no highlight. */
function viewToNavKey(view: View): NavKey | null {
  switch (view) {
    case "overview":
      return null;
    case "list":
      return "library";
    case "editor":
      return "editor";
    case "knowledge":
      // Phase C collapsed Profile into Knowledge tabs (T14). T15 relocated
      // the onboarding chat as a docked side-panel inside Profile, so it no
      // longer needs a top-level View.
      return "knowledge";
    case "inbox":
      return "inbox";
    case "applications":
      return "queue";
    case "dashboard":
      return "dashboard";
    case "tiers":
      return "tiers";
    case "settings":
      return "settings";
    case "history-massapply":
      return "history-massapply";
    case "jobs":
      // Jobs lives at /jobs route — no nav rail highlight.
      return null;
    default:
      return null;
  }
}

/** Map NavKey → breadcrumb labels used by TopBar. */
function viewToBreadcrumb(view: View): { section: string; route?: string } {
  switch (view) {
    case "overview":
      return { section: "Suite", route: "Overview" };
    case "list":
      return { section: "Per-job", route: "Library" };
    case "editor":
      return { section: "Per-job", route: "Editor" };
    case "knowledge":
      return { section: "Knowledge", route: "Knowledge" };
    case "inbox":
      return { section: "Mass-apply", route: "Inbox" };
    case "applications":
      return { section: "Mass-apply", route: "Queue" };
    case "dashboard":
      return { section: "Mass-apply", route: "Dashboard" };
    case "tiers":
      return { section: "Mass-apply", route: "Tiers" };
    case "settings":
      return { section: "Suite", route: "Settings" };
    case "history-massapply":
      return { section: "Mass-apply", route: "History" };
    case "jobs":
      return { section: "Suite", route: "Jobs" };
    default:
      return { section: "Suite" };
  }
}

function StateApp() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [view, setView] = useState<View>("overview");
  const [knowledgeTab, setKnowledgeTab] = useState<KnowledgeTab>("profile");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [unreadJobs, setUnreadJobs] = useState(0);
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();

  // Lifted from JobsBadge: poll active job count to feed TopBar.unreadCount.
  // TODO: T24 — replace with proper notifications drawer feed.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const { total } = await listJobs({ status: "queued,running" });
        if (!cancelled) setUnreadJobs(total);
      } catch {
        // ignore polling errors
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const goOverview = useCallback(() => {
    setOpenId(null);
    setView("overview");
  }, []);

  const goList = useCallback(() => {
    setOpenId(null);
    setView("list");
  }, []);

  const editorOpen = openId !== null;

  /** NavRail.onNavigate — translate NavKey back into View transitions. */
  const onNavigate = useCallback(
    (key: NavKey) => {
      switch (key) {
        case "library":
          setOpenId(null);
          setView("list");
          return;
        case "editor":
        case "diff":
          // Editor + Diff only render when an editor is open. The NavRail
          // hides them otherwise, so this is a no-op when editorOpen=false.
          if (editorOpen) setView("editor");
          return;
        case "tailor":
        case "jds":
        case "history-perjob":
          // TODO: Phase D — wire when those surfaces split out of Editor.
          setOpenId(null);
          setView("list");
          return;
        case "inbox":
          setView("inbox");
          return;
        case "queue":
          setView("applications");
          return;
        case "knowledge":
          setView("knowledge");
          return;
        case "dashboard":
          setView("dashboard");
          return;
        case "tiers":
          setView("tiers");
          return;
        case "settings":
          setView("settings");
          return;
        case "history-massapply":
          setView("history-massapply");
          return;
      }
    },
    [editorOpen],
  );

  // CommandPalette items — Navigation + Actions for now. Recent / Active
  // jobs groups are populated in Phase D/E.
  const paletteItems: CommandItem[] = useMemo(() => {
    const navItem = (
      id: string,
      label: string,
      run: () => void,
      hint?: string,
    ): CommandItem => ({ id, label, group: "Navigation", onRun: run, hint });

    const items: CommandItem[] = [
      navItem("nav-overview", "Overview", goOverview, "Suite"),
      navItem("nav-library", "Library", () => onNavigate("library"), "Per-job"),
      navItem("nav-jds", "Job posts", () => onNavigate("jds"), "Per-job"),
      navItem(
        "nav-history-perjob",
        "Per-job history",
        () => onNavigate("history-perjob"),
        "Per-job",
      ),
      navItem("nav-dashboard", "Dashboard", () => onNavigate("dashboard"), "Mass-apply"),
      navItem("nav-inbox", "Inbox", () => onNavigate("inbox"), "Mass-apply"),
      navItem("nav-queue", "Queue", () => onNavigate("queue"), "Mass-apply"),
      navItem(
        "nav-history-massapply",
        "Mass-apply history",
        () => onNavigate("history-massapply"),
        "Mass-apply",
      ),
      navItem("nav-knowledge", "Knowledge", () => onNavigate("knowledge"), "Mass-apply"),
      navItem("nav-tiers", "Tiers", () => onNavigate("tiers"), "Mass-apply"),
      navItem("nav-settings", "Settings", () => onNavigate("settings"), "Suite"),
      {
        id: "act-toggle-theme",
        label: "Toggle theme",
        group: "Actions",
        onRun: toggleTheme,
      },
      {
        id: "act-go-jobs",
        label: "Go to Jobs",
        group: "Actions",
        onRun: () => navigate("/jobs"),
      },
    ];
    if (editorOpen) {
      items.splice(2, 0, navItem("nav-editor", "Editor", () => setView("editor"), "Per-job"));
      items.splice(3, 0, navItem("nav-diff", "Diff", () => setView("editor"), "Per-job"));
    }
    return items;
  }, [goOverview, onNavigate, navigate, toggleTheme, editorOpen]);

  // If the Editor is open, take over the full content area (legacy behavior).
  // The NavRail still shows Editor + Diff entries via editorOpen=true.
  const content = editorOpen ? (
    <Editor id={openId!} onBack={() => setOpenId(null)} />
  ) : view === "overview" ? (
    <Overview />
  ) : view === "list" ? (
    <ResumeList onOpen={(id) => { setOpenId(id); setView("list"); }} />
  ) : view === "knowledge" ? (
    <Knowledge onBack={goList} tab={knowledgeTab} onTabChange={setKnowledgeTab} />
  ) : view === "inbox" ? (
    <Inbox onBack={goList} />
  ) : view === "applications" ? (
    <Queue onBack={goList} />
  ) : view === "dashboard" ? (
    <Dashboard onBack={goOverview} navigateOverride={(p) => navigate(p)} />
  ) : view === "tiers" ? (
    <Tiers onBack={goOverview} />
  ) : view === "settings" ? (
    <Settings onBack={goOverview} />
  ) : view === "history-massapply" ? (
    <HistoryMassApply onBack={goOverview} />
  ) : (
    <Overview />
  );

  return (
    <SuiteShell
      view={view}
      editorOpen={editorOpen}
      unreadCount={unreadJobs}
      theme={theme}
      onToggleTheme={toggleTheme}
      onOpenCommandPalette={() => setPaletteOpen(true)}
      onOpenNotifications={() => {
        // TODO: T24 — open notifications drawer.
      }}
      onNavigate={onNavigate}
      goOverview={goOverview}
    >
      {content}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
      />
    </SuiteShell>
  );
}

function JobsRoute() {
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Minimal palette while on /jobs — back-to-app navigation.
  const items: CommandItem[] = [
    {
      id: "nav-back",
      label: "Back to app",
      group: "Navigation",
      onRun: () => navigate("/"),
    },
    {
      id: "act-toggle-theme",
      label: "Toggle theme",
      group: "Actions",
      onRun: toggleTheme,
    },
  ];

  return (
    <SuiteShell
      view="jobs"
      editorOpen={false}
      unreadCount={0}
      theme={theme}
      onToggleTheme={toggleTheme}
      onOpenCommandPalette={() => setPaletteOpen(true)}
      onOpenNotifications={() => { /* TODO: T24 */ }}
      onNavigate={(key) => {
        // Any nav from inside /jobs returns to the main app, then routes.
        navigate("/");
        // Defer the View change to next tick so StateApp mounts first.
        setTimeout(() => {
          // No-op fallback: StateApp will land on its default Overview.
          // Specific deep-link handling is out of scope for this task.
          void key;
        }, 0);
      }}
      goOverview={() => navigate("/")}
    >
      <Jobs />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={items}
      />
    </SuiteShell>
  );
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => { api.me().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  if (authed === null) return <p>Loading…</p>;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/jobs" element={<JobsRoute />} />
        <Route path="*" element={<StateApp />} />
      </Routes>
    </BrowserRouter>
  );
}

/**
 * SuiteShell — TopBar + NavRail layout. Holds no state of its own; all
 * routing decisions live in the parent (StateApp / JobsRoute).
 */
function SuiteShell({
  children,
  view,
  editorOpen,
  unreadCount,
  theme,
  onToggleTheme,
  onOpenCommandPalette,
  onOpenNotifications,
  onNavigate,
  goOverview,
}: {
  children: React.ReactNode;
  view: View;
  editorOpen: boolean;
  unreadCount: number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenCommandPalette: () => void;
  onOpenNotifications: () => void;
  onNavigate: (key: NavKey) => void;
  goOverview: () => void;
}) {
  const breadcrumb = viewToBreadcrumb(view);
  const activeNav = viewToNavKey(view);

  // TODO: wire to Max-window endpoint when Slice 3 lands.
  const maxGaugeProps = useMemo(
    () => ({ usedPct: 0, resetsAt: new Date(Date.now() + 5 * 60 * 60 * 1000) }),
    [],
  );

  return (
    <div
      data-component="suite-shell"
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
    >
      <TopBar
        breadcrumb={breadcrumb}
        maxGaugeProps={maxGaugeProps}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onOpenCommandPalette={onOpenCommandPalette}
        unreadCount={unreadCount}
        onOpenNotifications={onOpenNotifications}
        onBreadcrumbClick={(level) => {
          if (level === "root") goOverview();
        }}
      />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <NavRail
          active={activeNav}
          onNavigate={onNavigate}
          editorOpen={editorOpen}
        />
        <main
          data-part="suite-content"
          style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

