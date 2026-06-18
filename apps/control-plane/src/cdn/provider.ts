import type { CdnProvider } from "@aerial/shared";

/** Result of creating a pull zone — persisted before any further config so a
 *  retried enable resumes the existing zone (idempotent state machine). */
export interface ProvisionResult {
  pullZoneId: string;
  cdnHostname: string; // <zone>.b-cdn.net
}

/**
 * A CDN backend Aerial can auto-provision (ADR D4 — "bring your own CDN").
 * Bunny is the v1 adapter; Gcore/CDN77/Cloudflare can follow by implementing this.
 * Each method is given the (decrypted) operator API key per call — the adapter is
 * stateless so a single instance serves every request.
 */
export interface CdnProviderAdapter {
  readonly id: CdnProvider;
  /** Create a pull zone with origin = originUrl; return its id + free b-cdn.net host. */
  provision(apiKey: string, originUrl: string): Promise<ProvisionResult>;
  /** Apply cache rules to an existing zone (respect origin Cache-Control, no slicing). */
  configure(apiKey: string, pullZoneId: string): Promise<void>;
  /** Delete the pull zone entirely (not used by disable, which keeps it intact). */
  teardown(apiKey: string, pullZoneId: string): Promise<void>;
}

/** DI token for the active CDN adapter (swap the binding to change providers). */
export const CDN_PROVIDER = Symbol("CDN_PROVIDER");
