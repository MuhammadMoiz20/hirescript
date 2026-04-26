import { useEffect, useState } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

const TABLET_MIN = "(min-width: 768px)";
const DESKTOP_MIN = "(min-width: 1200px)";

function read(): Breakpoint {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(DESKTOP_MIN).matches) return "desktop";
  if (window.matchMedia(TABLET_MIN).matches) return "tablet";
  return "mobile";
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => read());
  useEffect(() => {
    const tabletMql = window.matchMedia(TABLET_MIN);
    const desktopMql = window.matchMedia(DESKTOP_MIN);
    const update = () => setBp(read());
    tabletMql.addEventListener("change", update);
    desktopMql.addEventListener("change", update);
    return () => {
      tabletMql.removeEventListener("change", update);
      desktopMql.removeEventListener("change", update);
    };
  }, []);
  return bp;
}
