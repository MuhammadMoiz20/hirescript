/**
 * CommandPalette — HireScript Suite ⌘K modal.
 *
 * Pure presentational component. Parent owns:
 *   - whether the palette is open (TopBar T7 wires the global Cmd/Ctrl+K shortcut),
 *   - the list of `items` (assembled from nav, recent resumes, active jobs, actions),
 *   - each item's `onRun` side effect.
 *
 * The palette only handles in-modal concerns:
 *   - input filtering (lowercase substring match against label + keywords),
 *   - keyboard navigation (↑/↓ to move, Enter to run, Esc to close),
 *   - focus management (autofocus input on open, restore previous active element on close),
 *   - rendering grouped results with eyebrow group headers and a right-side hint.
 *
 * Visual treatment follows bundle `suite.jsx` (`SuiteCmd`) + `ma-shell.jsx` cues:
 *   centered ~600px paper modal, rule border, mono group labels, hover/active row.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

export type CommandGroup = "Navigation" | "Recent" | "Active jobs" | "Actions";

export interface CommandItem {
  id: string;
  label: string;
  group: CommandGroup;
  /** Extra fuzzy match terms (e.g. synonyms, route slugs). */
  keywords?: string[];
  /** Right-side mono hint (e.g. "Editor", "⌘D"). */
  hint?: string;
  onRun: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
  placeholder?: string;
}

const GROUP_ORDER: CommandGroup[] = ["Navigation", "Recent", "Active jobs", "Actions"];

const BACKDROP: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.32)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: "10vh",
  zIndex: 100,
};

const MODAL: CSSProperties = {
  width: 600,
  maxWidth: "calc(100vw - 32px)",
  maxHeight: "70vh",
  background: "var(--paper)",
  border: "1px solid var(--rule)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 24px 60px rgba(0,0,0,0.18)",
};

const INPUT_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 14px",
  borderBottom: "1px solid var(--rule)",
};

const INPUT: CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  color: "var(--ink)",
  fontFamily: "var(--f-sans)",
  fontSize: 14,
  lineHeight: 1.4,
};

const KBD: CSSProperties = {
  fontFamily: "var(--f-mono)",
  fontSize: 10,
  color: "var(--ink-3)",
  border: "1px solid var(--rule)",
  padding: "1px 5px",
  borderRadius: 2,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const LIST: CSSProperties = {
  overflowY: "auto",
  flex: 1,
};

const GROUP_LABEL: CSSProperties = {
  fontFamily: "var(--f-mono)",
  fontSize: 10,
  color: "var(--ink-4)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "10px 14px 4px",
};

function rowStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    background: active ? "var(--paper-2)" : "transparent",
    border: "none",
    borderLeft: active ? "2px solid var(--ink)" : "2px solid transparent",
    color: "var(--ink)",
    fontFamily: "var(--f-sans)",
    fontSize: 13,
    textAlign: "left",
    padding: "8px 14px",
    cursor: "pointer",
    lineHeight: 1.3,
  };
}

const HINT: CSSProperties = {
  marginLeft: "auto",
  fontFamily: "var(--f-mono)",
  fontSize: 11,
  color: "var(--ink-3)",
};

const EMPTY: CSSProperties = {
  padding: "24px 18px",
  color: "var(--ink-3)",
  fontSize: 13,
  textAlign: "center",
};

function matchItem(item: CommandItem, needle: string): boolean {
  if (!needle) return true;
  const haystack = [item.label, ...(item.keywords ?? [])].join(" ").toLowerCase();
  return haystack.includes(needle);
}

export default function CommandPalette({
  open,
  onClose,
  items,
  placeholder = "Jump to a screen, run a command…",
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Focus management: on open, capture previously-focused element and focus the input.
  // On close, restore focus.
  useEffect(() => {
    if (open) {
      restoreRef.current = (document.activeElement as HTMLElement) ?? null;
      // microtask: input is in the tree by render commit
      inputRef.current?.focus();
      setQuery("");
      setHighlight(0);
    } else if (restoreRef.current) {
      restoreRef.current.focus?.();
      restoreRef.current = null;
    }
  }, [open]);

  const needle = query.trim().toLowerCase();

  const filtered = useMemo(() => items.filter((it) => matchItem(it, needle)), [items, needle]);

  const grouped = useMemo(() => {
    const buckets = new Map<CommandGroup, CommandItem[]>();
    for (const it of filtered) {
      const arr = buckets.get(it.group) ?? [];
      arr.push(it);
      buckets.set(it.group, arr);
    }
    // Stable display order driven by GROUP_ORDER, dropping empty groups.
    const flatOrdered: CommandItem[] = [];
    const groupsForDisplay: Array<{ group: CommandGroup; items: CommandItem[] }> = [];
    for (const g of GROUP_ORDER) {
      const arr = buckets.get(g);
      if (arr && arr.length > 0) {
        groupsForDisplay.push({ group: g, items: arr });
        flatOrdered.push(...arr);
      }
    }
    return { flatOrdered, groupsForDisplay };
  }, [filtered]);

  // Reset highlight when filter changes; clamp to valid range.
  useEffect(() => {
    setHighlight(0);
  }, [needle]);

  if (!open) return null;

  const total = grouped.flatOrdered.length;
  const safeHighlight = total === 0 ? -1 : Math.min(highlight, total - 1);

  function runAt(index: number) {
    const item = grouped.flatOrdered[index];
    if (!item) return;
    item.onRun();
    onClose();
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (total === 0) return;
      setHighlight((h) => (h + 1) % total);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (total === 0) return;
      setHighlight((h) => (h - 1 + total) % total);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (safeHighlight >= 0) runAt(safeHighlight);
    }
  }

  function onBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      data-component="command-palette-backdrop"
      style={BACKDROP}
      onClick={onBackdropClick}
      onKeyDown={onKey}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-component="command-palette"
        style={MODAL}
      >
        <div style={INPUT_ROW}>
          <span aria-hidden style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-3)" }}>
            ⌘K
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Search commands"
            aria-controls="command-palette-list"
            style={INPUT}
          />
          <span style={KBD} aria-hidden>esc</span>
        </div>

        <div id="command-palette-list" role="listbox" aria-label="Commands" style={LIST}>
          {total === 0 ? (
            <div style={EMPTY}>No matches.</div>
          ) : (
            grouped.groupsForDisplay.map(({ group, items: groupItems }) => {
              return (
                <div key={group} data-group={group}>
                  <div style={GROUP_LABEL}>{group}</div>
                  {groupItems.map((item) => {
                    const flatIndex = grouped.flatOrdered.indexOf(item);
                    const isActive = flatIndex === safeHighlight;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        data-active={isActive ? "true" : "false"}
                        style={rowStyle(isActive)}
                        onMouseEnter={() => setHighlight(flatIndex)}
                        onClick={() => runAt(flatIndex)}
                      >
                        <span>{item.label}</span>
                        {item.hint && <span style={HINT}>{item.hint}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
