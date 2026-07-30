/**
 * Fetch layer for user & role administration — the users feature's local
 * `api`-style client (mirrors `src/api.ts`, kept in-feature so the whole surface
 * lives together). Every route is admin-only server-side (403 for streamers);
 * the JSON helper turns any non-2xx into a thrown `Error(message)` so the
 * screens can surface it verbatim (e.g. the 409 last-admin guard).
 *
 * Backend: apps/control-plane/src/users/* and apps/control-plane/src/streamer-keys/*.
 */

const BASE = "/api";

/** The two operator roles (canonical tuple lives server-side in auth/roles). */
export type Role = "admin" | "streamer";

/** One row of the admin user list — never any secret material. */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Whether this user currently holds a streamer key (drives issue vs. regenerate). */
  hasStreamerKey: boolean;
}

/** Returned exactly once on issue — the plaintext key is never stored or shown again. */
export interface StreamerKeyCreated {
  userId: string;
  key: string; // plaintext, shown once
  createdAt: string;
}

/** Throw the server's message (or a status fallback) on any non-2xx response. */
async function assertOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${res.status} ${res.statusText}`);
  }
  return res;
}

async function json<T>(res: Response): Promise<T> {
  await assertOk(res);
  return res.json() as Promise<T>;
}

export const usersApi = {
  /** GET /api/users → every operator + whether each holds a streamer key. */
  list: () => fetch(`${BASE}/users`).then(json<UserSummary[]>),

  /** PATCH /api/users/:id/role → set role. 409 (thrown) if it would demote the last admin. */
  setRole: (id: string, role: Role) =>
    fetch(`${BASE}/users/${id}/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    }).then(json<UserSummary>),

  /** POST /api/users/:id/streamer-key → issue/regenerate; returns plaintext once. */
  createStreamerKey: (id: string) =>
    fetch(`${BASE}/users/${id}/streamer-key`, { method: "POST" }).then(json<StreamerKeyCreated>),

  /**
   * DELETE /api/users/:id/streamer-key → revoke (idempotent, 204 no body).
   * Success returns no body, so this checks status only (never parses) — but a
   * failure (e.g. 403 for a streamer) still throws, so it surfaces via ErrorNote.
   */
  revokeStreamerKey: (id: string) =>
    fetch(`${BASE}/users/${id}/streamer-key`, { method: "DELETE" }).then(assertOk),
};
