import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Logo, TAGLINE } from "@/brand";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote } from "@/components/error-note";
import { signIn, useSession } from "@/auth-client";
import { authRedirect } from "./auth-redirect";

// "1" shows the corresponding social sign-in button (baked in at build time,
// env-gated per ADR D13 — off in v1, switched on by setting credentials).
const googleEnabled = import.meta.env.VITE_GOOGLE_ENABLED === "1";
const githubEnabled = import.meta.env.VITE_GITHUB_ENABLED === "1";

export function LoginScreen() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const decision = authRedirect({ isPending, hasSession: !!session, onLoginPage: true });

  useEffect(() => {
    if (decision.kind === "redirect") void navigate({ to: decision.to });
  }, [decision, navigate]);

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

  if (decision.kind === "redirect") return null;

  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-4 px-4 py-10">
      <div className="grid gap-1">
        <Logo className="text-2xl" />
        <p className="text-sm text-muted-foreground">{TAGLINE}</p>
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}

      <Card>
        <CardContent className="p-5">
          <form className="grid gap-3" onSubmit={submit}>
            <Input
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {(googleEnabled || githubEnabled) && (
        <Card>
          <CardContent className="grid gap-3 p-5">
            {googleEnabled && (
              <Button
                variant="outline"
                onClick={() => signIn.social({ provider: "google", callbackURL: "/" })}
              >
                Continue with Google
              </Button>
            )}
            {githubEnabled && (
              <Button
                variant="outline"
                onClick={() => signIn.social({ provider: "github", callbackURL: "/" })}
              >
                Continue with GitHub
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
