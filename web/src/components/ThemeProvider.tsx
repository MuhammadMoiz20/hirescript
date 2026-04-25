import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";

type Theme = "light" | "dark";
const KEY = "hs-theme";

const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });

export function useTheme() { return useContext(Ctx); }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem(KEY) as Theme) || "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);
  const value = useMemo(() => ({
    theme,
    toggle: () => setTheme(t => (t === "light" ? "dark" : "light")),
  }), [theme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
