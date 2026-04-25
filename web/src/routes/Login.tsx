import { useState } from "react";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import Input from "../components/ui/Input";
import { api } from "../api";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.login(password);
      onSuccess();
    } catch {
      setError("Invalid password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--paper)",
        padding: 24,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 420,
          background: "var(--paper-2)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--f-serif)",
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              lineHeight: 1.1,
              color: "var(--ink)",
            }}
          >
            HireScript
          </h1>
          <div
            style={{
              marginTop: 6,
              fontFamily: "var(--f-mono)",
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            One resume, tailored endlessly.
          </div>
        </div>

        <Field label="Password">
          <Input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{ fontFamily: "var(--f-mono)", letterSpacing: "0.1em" }}
          />
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            type="submit"
            variant="primary"
            disabled={busy}
            style={{ justifyContent: "center", padding: "9px 14px" }}
          >
            Log in
          </Button>
        </div>

        {error && (
          <p
            role="alert"
            className="mono"
            style={{
              margin: 0,
              fontFamily: "var(--f-mono)",
              fontSize: 12,
              color: "var(--err)",
            }}
          >
            {error}
          </p>
        )}

        <div
          style={{
            marginTop: 4,
            color: "var(--ink-3)",
            fontFamily: "var(--f-mono)",
            fontSize: 12,
          }}
        >
          single-tenant · self-hosted
        </div>
      </form>
    </div>
  );
}
