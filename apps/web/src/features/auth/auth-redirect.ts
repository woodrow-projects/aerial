/**
 * Pure session-gating decision shared by the shell guard and the login screen.
 *
 * Extracted from the old `session ? <Dashboard/> : <Login/>` switch in App.tsx
 * so the redirect contract can be unit-tested without a router or a live
 * better-auth session. Both directions are covered:
 *   - no session on a protected page  -> /login
 *   - a session on the login page      -> /
 * While better-auth is still resolving the session we render a loading state
 * rather than redirecting (avoids a flash-to-login on every refresh).
 */
export type AuthRedirect =
  | { kind: "loading" }
  | { kind: "redirect"; to: string }
  | { kind: "allow" };

export function authRedirect(params: {
  isPending: boolean;
  hasSession: boolean;
  onLoginPage: boolean;
}): AuthRedirect {
  if (params.isPending) return { kind: "loading" };
  if (!params.hasSession && !params.onLoginPage) return { kind: "redirect", to: "/login" };
  if (params.hasSession && params.onLoginPage) return { kind: "redirect", to: "/" };
  return { kind: "allow" };
}
