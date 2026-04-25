import { SVGProps } from "react";

export type GlyphName =
  | "check" | "cross" | "x" | "dots" | "warn" | "alert" | "dash"
  | "doc" | "docs" | "history" | "sparkle" | "wand" | "chat"
  | "gear" | "plus" | "cmd" | "arrow-r" | "chevron-d" | "chevron-r"
  | "eye" | "download" | "upload" | "paste" | "search" | "user"
  | "panel" | "panel-r" | "sun" | "moon" | "undo" | "filter" | "link"
  | "compile" | "clock" | "pdf" | "latex" | "form" | "edit" | "book";

interface Props extends Omit<SVGProps<SVGSVGElement>, "name" | "stroke"> {
  name: GlyphName;
  size?: number;
  stroke?: number;
}

export default function Glyph({ name, size = 14, stroke = 1.5, ...rest }: Props) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
  switch (name) {
    case "check": return <svg {...props}><path d="M3.5 8.5l3 3 6-7" /></svg>;
    case "cross":
    case "x": return <svg {...props}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
    case "dots": return <svg {...props}><circle cx="3" cy="8" r="0.8" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none" /><circle cx="13" cy="8" r="0.8" fill="currentColor" stroke="none" /></svg>;
    case "warn":
    case "alert": return <svg {...props}><path d="M8 2l6 11H2z" /><path d="M8 7v3" /><circle cx="8" cy="12" r="0.5" fill="currentColor" stroke="none" /></svg>;
    case "dash": return <svg {...props}><path d="M3 8h10" /></svg>;
    case "doc":
    case "pdf":
    case "latex": return <svg {...props}><path d="M4 2h5l3 3v9H4z" /><path d="M9 2v3h3" /></svg>;
    case "docs":
    case "book": return <svg {...props}><path d="M3 3h6l3 3v7H3z" /><path d="M6 6h6v7" /></svg>;
    case "history":
    case "clock": return <svg {...props}><path d="M3 8a5 5 0 1 0 1.5-3.5" /><path d="M3 3v3h3" /><path d="M8 5v3l2 2" /></svg>;
    case "sparkle":
    case "wand": return <svg {...props}><path d="M8 2v4M8 10v4M2 8h4M10 8h4" /></svg>;
    case "chat": return <svg {...props}><path d="M3 4h10v7H7l-3 3v-3H3z" /></svg>;
    case "gear": return <svg {...props}><circle cx="8" cy="8" r="2.2" /><path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4" /></svg>;
    case "plus": return <svg {...props}><path d="M8 3v10M3 8h10" /></svg>;
    case "cmd": return <svg {...props}><path d="M5.5 3.5A1.5 1.5 0 1 0 4 5h8a1.5 1.5 0 1 0-1.5-1.5v8A1.5 1.5 0 1 0 12 11H4a1.5 1.5 0 1 0 1.5 1.5v-8z" /></svg>;
    case "arrow-r": return <svg {...props}><path d="M4 8h8M9 5l3 3-3 3" /></svg>;
    case "chevron-d": return <svg {...props}><path d="M4 6l4 4 4-4" /></svg>;
    case "chevron-r": return <svg {...props}><path d="M6 4l4 4-4 4" /></svg>;
    case "eye": return <svg {...props}><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.8" /></svg>;
    case "download": return <svg {...props}><path d="M8 2v9M4 8l4 4 4-4M3 13.5h10" /></svg>;
    case "upload": return <svg {...props}><path d="M8 13V4M4 7l4-4 4 4M3 13.5h10" /></svg>;
    case "paste": return <svg {...props}><path d="M5 3h6v2H5z" /><path d="M4 4H3v10h10V4h-1" /></svg>;
    case "search": return <svg {...props}><circle cx="7" cy="7" r="4" /><path d="M10 10l3 3" /></svg>;
    case "user": return <svg {...props}><circle cx="8" cy="6" r="2.5" /><path d="M3 13c1-2.5 3-3.5 5-3.5s4 1 5 3.5" /></svg>;
    case "panel":
    case "compile":
    case "form":
    case "edit": return <svg {...props}><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M6 3v10" /></svg>;
    case "panel-r": return <svg {...props}><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M10 3v10" /></svg>;
    case "sun": return <svg {...props}><circle cx="8" cy="8" r="2.5" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" /></svg>;
    case "moon": return <svg {...props}><path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z" /></svg>;
    case "undo": return <svg {...props}><path d="M3 8h7a3 3 0 0 1 0 6H6" /><path d="M5 5L2.5 7.5 5 10" /></svg>;
    case "filter": return <svg {...props}><path d="M2 3h12l-4.5 6v4l-3 1.5v-5.5z" /></svg>;
    case "link": return <svg {...props}><path d="M7 9l2-2M6 10L4 12a2 2 0 0 1-2.8-2.8l2-2M10 6l2-2a2 2 0 0 1 2.8 2.8l-2 2" /></svg>;
    default: return null;
  }
}
