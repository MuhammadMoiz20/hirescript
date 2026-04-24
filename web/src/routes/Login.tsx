import { useState } from "react";
import { api } from "../api";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try { await api.login(password); onSuccess(); }
    catch { setError("Invalid password"); }
  }
  return (
    <form onSubmit={submit}>
      <label>Password <input type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button type="submit">Log in</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
