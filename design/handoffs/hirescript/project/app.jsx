// HireScript — app root & router
const { useState: useStateR, useEffect: useEffectR } = React;

function App() {
  const hash = useHash();
  const [cmdOpen, setCmdOpen] = useStateR(false);

  useEffectR(() => {
    window.__openCmd = () => setCmdOpen(true);
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Route
  let screen;
  const [path, ...rest] = hash.replace(/^#\//, "").split("/");
  switch (path) {
    case "":
    case "login":       screen = <LoginScreen />; break;
    case "onboarding":  screen = <OnboardingScreen />; break;
    case "library":     screen = <LibraryScreen />; break;
    case "editor":      screen = <EditorScreen resumeId={rest[0] || "r_stripe"} />; break;
    case "diff":        screen = <DiffScreen />; break;
    case "tailor":      screen = <TailorScreen />; break;
    case "history":     screen = <HistoryScreen />; break;
    case "jds":         screen = <JDsScreen />; break;
    case "overflow":    screen = <OverflowScreen />; break;
    case "settings":    screen = <SettingsScreen />; break;
    case "kitchen":     screen = <KitchenScreen />; break;
    default:            screen = <LoginScreen />;
  }

  return (
    <ThemeProvider>
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {screen}
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
        <ScreenDock />
      </div>
    </ThemeProvider>
  );
}

// Small floating dock for jumping between screens (helps reviewing the deliverable)
function ScreenDock() {
  const hash = useHash();
  const [open, setOpen] = useStateR(false);
  const screens = [
    ["1. Login", "#/login"],
    ["2. Onboarding", "#/onboarding"],
    ["3. Library", "#/library"],
    ["4. Editor", "#/editor/r_stripe"],
    ["5. Diff viewer", "#/diff"],
    ["6. Tailor to JD", "#/tailor"],
    ["7. History", "#/history"],
    ["8. JDs", "#/jds"],
    ["9. Overflow", "#/editor/r_linear"],
    ["10. Settings", "#/settings"],
    ["Kitchen sink", "#/kitchen"],
  ];
  return (
    <div style={{ position: "fixed", bottom: 14, right: 14, zIndex: 90, fontFamily: "var(--f-mono)" }}>
      {open && (
        <div style={{
          background: "var(--paper)", border: "1px solid var(--rule-strong)",
          borderRadius: 4, padding: 6, marginBottom: 6,
          boxShadow: "0 12px 30px -12px oklch(0 0 0 / 0.25)",
          minWidth: 200,
        }}>
          {screens.map(([label, href]) => {
            const active = hash === href || (href === "#/library" && hash === "");
            return (
              <a key={href} href={href} onClick={() => setOpen(false)} style={{
                display: "block", padding: "5px 10px", borderRadius: 2, fontSize: 12,
                background: active ? "var(--paper-2)" : "transparent",
                color: active ? "var(--ink)" : "var(--ink-2)",
              }}>
                {label}
              </a>
            );
          })}
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} style={{
        background: "var(--ink)", color: "var(--paper)",
        border: "1px solid var(--ink)", borderRadius: 4,
        padding: "6px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6,
        boxShadow: "0 6px 20px -8px oklch(0 0 0 / 0.3)",
      }}>
        <Glyph name="panel" size={12} />
        {open ? "Close" : "Screens"}
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
