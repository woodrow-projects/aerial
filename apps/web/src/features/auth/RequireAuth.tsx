import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSession } from "@/auth-client";
import { LoadingScreen } from "@/components/loading-screen";
import { authRedirect } from "./auth-redirect";

/**
 * Gate for the authed app shell. Mirrors the old `session ? <Dashboard/> : <Login/>`
 * switch, but as a route guard: no session -> /login; still-resolving -> loading.
 * The redirect-the-other-way (session on /login -> /) lives in LoginScreen.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const decision = authRedirect({ isPending, hasSession: !!session, onLoginPage: false });

  useEffect(() => {
    if (decision.kind === "redirect") void navigate({ to: decision.to });
  }, [decision, navigate]);

  if (decision.kind === "loading") return <LoadingScreen />;
  if (decision.kind === "redirect") return null;
  return <>{children}</>;
}
