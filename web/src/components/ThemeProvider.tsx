import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";

type Theme = "light" | "dark";
const KEY = "hs-theme";

function readStored(): Theme | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : null;
}

function osPref(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });

export function useTheme() { return useContext(Ctx); }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? osPref());
  const [explicit, setExplicit] = useState<boolean>(() => readStored() !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (explicit) localStorage.setItem(KEY, theme);
  }, [theme, explicit]);

  useEffect(() => {
    if (explicit) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [explicit]);

  const value = useMemo(() => ({
    theme,
    toggle: () => {
      setExplicit(true);
      setTheme(t => (t === "light" ? "dark" : "light"));
    },
  }), [theme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
