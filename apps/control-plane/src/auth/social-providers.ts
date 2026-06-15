import type { BetterAuthOptions } from "better-auth";

/**
 * Env-gated social providers (ADR: better-auth over OpenAuth). A provider is
 * enabled only when both its client id and secret are present — so v1 ships
 * email+password, and an operator switches on Google/GitHub later by setting env
 * and rebuilding the image (no handler/guard change needed).
 *
 * Redirect URIs to register with the provider:
 *   <PUBLIC_BASE_URL>/api/auth/callback/google
 *   <PUBLIC_BASE_URL>/api/auth/callback/github
 */
export function buildSocialProviders(): BetterAuthOptions["socialProviders"] {
  const e = process.env;
  const providers: NonNullable<BetterAuthOptions["socialProviders"]> = {};

  if (e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) {
    providers.google = { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET };
  }
  if (e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET) {
    // scope user:email is required for GitHub to return the user's email.
    providers.github = {
      clientId: e.GITHUB_CLIENT_ID,
      clientSecret: e.GITHUB_CLIENT_SECRET,
      scope: ["user:email"],
    };
  }
  return providers;
}
