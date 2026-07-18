import { APIError } from "better-auth/api";

/** Operator roles. RBAC enforcement lands with Auto-DJ/scheduling; today only
 * the first-admin assignment uses these. */
export const ADMIN_ROLE = "admin";
export const STREAMER_ROLE = "streamer";

/**
 * better-auth `databaseHooks.user.create.before` body.
 *
 * Makes operator sign-up self-locking: when the user table is empty the new
 * account becomes the **admin**; once any user exists, sign-up is closed. This
 * replaces the old `AUTH_DISABLE_SIGNUP` flip + redeploy dance (and its window
 * where registration was open). It fires on every creation path (email + social).
 *
 * @param user        the user record better-auth is about to create
 * @param countUsers  returns the current number of users (injected for testing)
 * @returns the data to persist, with `role` set to admin for the first user
 * @throws APIError(403) once any user already exists
 */
export async function firstRunCreateGate<T extends Record<string, unknown>>(
  user: T,
  countUsers: () => Promise<number>,
): Promise<{ data: T & { role: string } }> {
  const existing = await countUsers();
  if (existing > 0) {
    throw new APIError("FORBIDDEN", {
      message: "Sign-up is closed: an administrator already exists.",
      code: "SIGNUP_CLOSED",
    });
  }
  return { data: { ...user, role: ADMIN_ROLE } };
}
