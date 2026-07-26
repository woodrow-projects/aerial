/**
 * Provider interface (docs/plans/aerial-cli.md — shaped by the 4-provider
 * scan: Hetzner, DigitalOcean, Vultr, Linode).
 *
 * Interface constraints that are load-bearing:
 * - Flat marker tag `aerial` is the common denominator (Hetzner's adapter maps
 *   it onto a `managed-by=aerial` label internally). DO tags cannot contain
 *   dots, so station identity rides on the RESOURCE NAME (= station domain),
 *   never on a tag value.
 * - DNS zones are discovered BY NAME (a zone belongs to a station iff its name
 *   equals the station domain) — DO domains cannot be tagged at all.
 * - One opaque token per provider covers compute + DNS.
 */

export const PROVIDER_IDS = ["hetzner", "digitalocean"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Marker on every compute resource the CLI creates. */
export const MARKER_TAG = "aerial";

export interface SizeInfo {
  /** Provider size slug, e.g. "cpx11" / "s-1vcpu-2gb". */
  id: string;
  description: string;
  /** Live from the provider's pricing API — never hardcoded. */
  priceMonthly: string;
  currency: string;
  /** Region the VM will land in (adapter's opinionated default). */
  region: string;
}

export interface CreateVmInput {
  domain: string;
  /** OpenSSH public key line (uploaded/reused per user, tagged). */
  publicKey: string;
  /** cloud-init user-data. INVARIANT: never contains secrets (metadata
   *  endpoints serve it back to any process on the box — ADR D10). */
  userData: string;
  /** Size override (`--size`); adapter default when absent. */
  size?: string;
}

export interface CreatedVm {
  id: string;
  ipv4: string;
  size: string;
  region: string;
}

export interface StationSummary {
  domain: string;
  provider: ProviderId;
  ipv4: string;
  size: string;
  region: string;
  createdAt: string;
}

export interface CreatedZone {
  id: string;
  /** Nameservers the user must set at their registrar. */
  nameservers: string[];
}

export interface DestroyableResource {
  kind: "vm" | "zone" | "firewall" | "ssh-key";
  id: string;
  /** Human line for the pre-destroy listing, e.g. "VM cpx11 (Falkenstein)". */
  label: string;
}

/**
 * One cloud provider adapter. Constructed per invocation with the saved token;
 * all HTTP goes through an injected fetch (unit tests never hit the network).
 */
export interface CloudProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  /** Console walkthrough for minting the one API token (the accepted one-time
   *  manual step) — including Hetzner's project concept + KYC heads-up. */
  readonly tokenHelp: string;

  /** True if the token authenticates (used right after paste). */
  verifyToken(): Promise<boolean>;

  /** Opinionated default: the cheapest size with >= 2 GB RAM in the adapter's
   *  default region, with its live monthly price. */
  defaultSize(): Promise<SizeInfo>;

  /**
   * Provision everything compute-side for a station: reuse-or-upload the ssh
   * key, create the per-station firewall (22, 80, 443 tcp; 443 udp;
   * 8100-8110 tcp ingest), create the VM (name = domain, marker-tagged),
   * and wait until it has a public IPv4.
   */
  provisionStation(input: CreateVmInput): Promise<CreatedVm>;

  /** Delegation path: create the zone; returns the nameservers to print. */
  createZone(domain: string): Promise<CreatedZone>;

  /** Delegation path: apex A record for `domain` → `ipv4` in its zone. */
  createApexRecord(domain: string, ipv4: string): Promise<void>;

  /** All stations at this provider (marker-tagged VMs; identity = VM name). */
  listStations(): Promise<StationSummary[]>;

  /**
   * Everything `down <domain>` would delete, by discovery (never from cache):
   * the station's VM + firewall, its zone (by name), and — only when this is
   * the provider's last aerial-tagged station — the shared ssh key.
   */
  discoverStationResources(domain: string): Promise<DestroyableResource[]>;

  /** Delete in a safe order (vm → firewall → zone → ssh-key). */
  destroyResources(resources: DestroyableResource[]): Promise<void>;
}

export interface ProviderDeps {
  token: string;
  fetch: typeof globalThis.fetch;
}
