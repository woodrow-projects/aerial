/**
 * The answers `aerial up` collects and feeds to deploy/install.sh
 * non-interactively (the CLI owns all prompts; install.sh is the engine).
 * Maps 1:1 onto install.sh's documented env vars.
 */
export interface InstallAnswers {
  /** Caddy site address: the station domain, or ":80" for local mode. */
  siteAddress: string;
  /** Let's Encrypt email ("" in local mode — no TLS). */
  acmeEmail: string;
  publicBaseUrl: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
}

/** install.sh's non-interactive contract (see deploy/install.sh header). */
export function installEnv(a: InstallAnswers): Record<string, string> {
  return {
    SITE_ADDRESS: a.siteAddress,
    ACME_EMAIL: a.acmeEmail,
    PUBLIC_BASE_URL: a.publicBaseUrl,
    ADMIN_EMAIL: a.adminEmail,
    ADMIN_NAME: a.adminName,
    ADMIN_PASSWORD: a.adminPassword,
  };
}
