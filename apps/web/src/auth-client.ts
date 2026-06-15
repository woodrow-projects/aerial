import { createAuthClient } from "better-auth/react";

// Same-origin in both envs (prod: control-plane/Caddy serves the SPA; dev: Vite
// proxies /api -> :3000), so no baseURL/CORS needed; basePath defaults to
// /api/auth. The session cookie is httpOnly + SameSite=Lax and rides along on
// the existing same-origin fetches in api.ts (no credentials:"include" needed).
export const authClient = createAuthClient({});

export const { signIn, signUp, signOut, useSession } = authClient;
