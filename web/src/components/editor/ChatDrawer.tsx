import { ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export default function ChatDrawer({ open, onClose, children }: Props) {
  if (!open) return null;
  return (
    <>
      <div
        data-testid="chat-drawer-backdrop"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 40,
          background: "color-mix(in oklch, var(--ink) 35%, transparent)",
        }}
      />
      <aside
        role="dialog"
        aria-label="Chat"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(380px, 90vw)",
          background: "var(--paper-2)",
          borderLeft: "1px solid var(--rule-strong)",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </aside>
    </>
  );
}
