/**
 * ModeToggle — mass-apply primitive.
 *
 * A/B pill. Filled side = active mode. When `override` is true, the active
 * label is bolder (signals the user has pinned this mode rather than
 * inheriting it from the tier default).
 *
 * Used in two contexts:
 *   - Per-job rows: clickable, can override the tier's default mode.
 *   - B-mode-only contexts (e.g. tier banner): rendered with `disabled`
 *     so it acts as a read-only indicator.
 *
 * Visual treatment ported from bundle ma-primitives.jsx (`ModeToggle`).
 * Uses the established convention: `data-*` attributes for testability,
 * `sm`/`lg` sizes, no extraneous props.
 */

export type Mode = "A" | "B";

interface Props {
  mode: Mode;
  override?: boolean;
  disabled?: boolean;
  size?: "sm" | "lg";
  onChange?: (mode: Mode) => void;
}

interface SideProps {
  side: Mode;
  glyph: string;
  active: boolean;
  override: boolean;
  disabled: boolean;
  fontSize: number;
  padY: number;
  padX: number;
  onSelect?: (mode: Mode) => void;
}

function Side({ side, glyph, active, override, disabled, fontSize, padY, padX, onSelect }: SideProps) {
  const interactive = !disabled && !!onSelect;
  return (
    <button
      type="button"
      data-side={side}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      aria-label={`Mode ${side}`}
      disabled={disabled}
      onClick={interactive ? () => onSelect?.(side) : undefined}
      tabIndex={interactive ? 0 : -1}
      style={{
        all: "unset",
        padding: `${padY}px ${padX}px`,
        background: active ? "var(--ink)" : "transparent",
        color: active ? "var(--paper)" : "var(--ink-3)",
        fontWeight: active ? (override ? 700 : 500) : 400,
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        cursor: interactive ? "pointer" : "default",
        userSelect: "none",
        fontFamily: "var(--f-mono)",
        fontSize,
      }}
    >
      <span aria-hidden style={{ fontSize: fontSize - 1 }}>{glyph}</span>
      {side}
    </button>
  );
}

export default function ModeToggle({
  mode,
  override = false,
  disabled = false,
  size = "sm",
  onChange,
}: Props) {
  const fs = size === "lg" ? 12 : 10;
  const padY = size === "lg" ? 3 : 2;
  const padX = size === "lg" ? 9 : 7;
  const stateLabel = override ? "override" : "tier default";

  return (
    <span
      role="group"
      aria-label="Mode toggle"
      data-mode={mode}
      data-override={override ? "true" : "false"}
      data-disabled={disabled ? "true" : "false"}
      data-size={size}
      title={`Mode ${mode} (${stateLabel})${disabled ? " — read-only" : ""}`}
      style={{
        display: "inline-flex",
        fontFamily: "var(--f-mono)",
        fontSize: fs,
        border: "1px solid var(--rule)",
        borderRadius: 2,
        overflow: "hidden",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <Side
        side="A"
        glyph="⚡"
        active={mode === "A"}
        override={override}
        disabled={disabled}
        fontSize={fs}
        padY={padY}
        padX={padX}
        onSelect={onChange}
      />
      <Side
        side="B"
        glyph="◉"
        active={mode === "B"}
        override={override}
        disabled={disabled}
        fontSize={fs}
        padY={padY}
        padX={padX}
        onSelect={onChange}
      />
    </span>
  );
}
