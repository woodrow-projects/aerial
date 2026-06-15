import { useState } from "react";
import { signIn } from "./auth-client";

const googleEnabled = import.meta.env.VITE_GOOGLE_ENABLED === "1";
const githubEnabled = import.meta.env.VITE_GITHUB_ENABLED === "1";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    await signIn.email(
      { email, password, rememberMe: true, callbackURL: "/" },
      { onError: (ctx) => setErr(ctx.error.message) },
    );
    setBusy(false);
  };

  return (
    <div className="app">
      <header>
        <h1>
          Aerial <span className="tag">sign in</span>
        </h1>
        <p className="muted">Operator control plane</p>
      </header>

      {err && <div className="error">{err}</div>}

      <form className="card login" onSubmit={submit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {(googleEnabled || githubEnabled) && (
        <div className="card login">
          {googleEnabled && (
            <button onClick={() => signIn.social({ provider: "google", callbackURL: "/" })}>
              Continue with Google
            </button>
          )}
          {githubEnabled && (
            <button onClick={() => signIn.social({ provider: "github", callbackURL: "/" })}>
              Continue with GitHub
            </button>
          )}
        </div>
      )}
    </div>
  );
}
