import { ReactNode } from "react";
import Glyph from "./Glyph";
import { useTheme } from "../ThemeProvider";

interface Props {
  children?: ReactNode;
  right?: ReactNode;
  onLogoClick?: () => void;
}

function Wordmark() {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      fontFamily: "var(--f-serif)", fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em",
    }}>
      <span style={{ display: "inline-block", width: 16, height: 20, background: "var(--ink)", position: "relative" }}>
        <span style={{ position: "absolute", inset: 3, background: "var(--paper)", borderLeft: "1px solid var(--ink)" }} />
      </span>
      HireScript
    </span>
  );
}

export default function TopChrome({ children, right, onLogoClick }: Props) {
  const { theme, toggle } = useTheme();
  return (
    <header
      id="top-chrome"
      style={{
        height: "var(--top-chrome)",
        display: "flex",
        alignItems: "center",
        borderBottom: "1px solid var(--rule)",
        padding: "0 12px",
        gap: 12,
        background: "var(--paper)",
        flexShrink: 0,
      }}
    >
      <span style={{
        display: "flex", alignItems: "center", gap: 7,
        paddingRight: 10, borderRight: "1px solid var(--rule)", height: "100%",
      }}>
        {onLogoClick ? (
          <button
            onClick={onLogoClick}
            aria-label="Go to dashboard"
            style={{
              background: "transparent", border: "none", padding: 0, cursor: "pointer",
              color: "inherit", display: "inline-flex", alignItems: "center",
            }}
          >
            <Wordmark />
          </button>
        ) : (
          <Wordmark />
        )}
      </span>
      {children && (
        <span className="mono" style={{
          fontSize: 11.5, color: "var(--ink-3)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {children}
        </span>
      )}
      <div style={{ flex: 1 }} />
      {right}
      <button
        onClick={toggle}
        title="Toggle theme"
        aria-label="Toggle theme"
        style={{
          width: 28, height: 28, display: "inline-flex",
          alignItems: "center", justifyContent: "center",
          border: "1px solid var(--rule)", borderRadius: 3, color: "var(--ink-2)",
        }}
      >
        <Glyph name={theme === "dark" ? "sun" : "moon"} size={13} />
      </button>
    </header>
  );
}
