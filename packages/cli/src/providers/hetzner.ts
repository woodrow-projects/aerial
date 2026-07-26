import { CliError } from "../context";
import type {
  CloudProvider,
  CreatedVm,
  CreatedZone,
  CreateVmInput,
  DestroyableResource,
  ProviderDeps,
  SizeInfo,
  StationSummary,
} from "./types";

/**
 * Hetzner Cloud adapter. Maps the flat `aerial` marker tag onto a
 * `managed-by=aerial` label (Hetzner has key=value labels + server-side label
 * selectors); station identity rides on resource names (types.ts). DNS uses
 * the Cloud API's zones/rrsets endpoints — the old dns.hetzner.com API was
 * discontinued May 2026. Shapes verified against docs.hetzner.cloud
 * (cloud.spec.json, 2026-07-20).
 */

const BASE = "https://api.hetzner.cloud/v1";
const LOCATION = "fsn1";
const IMAGE = "ubuntu-24.04";
const SSH_KEY_NAME = "aerial";
const MARKER_LABELS = { "managed-by": "aerial" };
const MARKER_SELECTOR = "managed-by=aerial";
const firewallName = (domain: string) => `aerial-${domain}`;

const ANYWHERE = ["0.0.0.0/0", "::/0"];
// 22 ssh, 80/443 http(s), udp 443 QUIC, 8100-8110 stream ingest.
const FIREWALL_RULES = [
  { direction: "in", protocol: "tcp", port: "22", source_ips: ANYWHERE },
  { direction: "in", protocol: "tcp", port: "80", source_ips: ANYWHERE },
  { direction: "in", protocol: "tcp", port: "443", source_ips: ANYWHERE },
  { direction: "in", protocol: "udp", port: "443", source_ips: ANYWHERE },
  { direction: "in", protocol: "tcp", port: "8100-8110", source_ips: ANYWHERE },
];

const POLL_INTERVAL_MS = 5_000;
const POLL_ATTEMPTS = 60;
// Firewall delete can race the VM teardown while the server still holds it.
const FW_DELETE_RETRIES = 5;
const FW_RETRY_MS = 3_000;

const TOKEN_HELP = [
  "1. Sign in at https://console.hetzner.cloud — new accounts may take up to a",
  "   day to pass Hetzner's identity verification.",
  "2. Hetzner groups resources into projects; open (or create) one for your station.",
  "3. In the project: Security -> API tokens -> Generate API token (Read & Write).",
  "4. Copy the token now — Hetzner shows it only once.",
].join("\n");

const tokenError = () =>
  new CliError(
    "Hetzner rejected the API token",
    "Mint a Read & Write API token in the Hetzner Cloud console: your project -> Security -> API tokens.",
  );

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

interface PriceDto {
  net: string;
  gross: string;
}
interface ServerTypeDto {
  name: string;
  cores: number;
  memory: number;
  disk: number;
  cpu_type: string;
  prices: Array<{ location: string; price_monthly: PriceDto }>;
  /** Availability + deprecation are per-location (`locations[].deprecation`). */
  locations?: Array<{ name: string; deprecation: unknown }>;
}
interface ServerDto {
  id: number;
  name: string;
  status: string;
  created: string;
  public_net: { ipv4: { ip: string } | null };
  server_type: { name: string };
  location: { name: string; city?: string };
}
interface ZoneDto {
  id: number;
  name: string;
  authoritative_nameservers: { assigned: string[] };
}
interface NamedDto {
  id: number;
  name: string;
}

export function hetznerProvider(deps: ProviderDeps, sleep: Sleep = realSleep): CloudProvider {
  const send = async (method: string, path: string, body?: unknown): Promise<Response> => {
    try {
      return await deps.fetch(`${BASE}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${deps.token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new CliError(
        "Could not reach the Hetzner API",
        "Check your network connection (and https://status.hetzner.com), then retry.",
      );
    }
  };

  const fail = async (res: Response): Promise<never> => {
    if (res.status === 401) throw tokenError();
    let detail = `HTTP ${res.status}`;
    try {
      const { error } = (await res.json()) as { error?: { code?: string; message?: string } };
      if (error?.message) detail = `${error.code}: ${error.message}`;
    } catch {
      // non-JSON error body — keep the status line
    }
    throw new CliError(`Hetzner API request failed (${detail})`);
  };

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await send(method, path, body);
    if (!res.ok) await fail(res);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  };

  const findSshKey = async (): Promise<number | undefined> => {
    const { ssh_keys } = await request<{ ssh_keys: NamedDto[] }>(
      "GET",
      `/ssh_keys?name=${SSH_KEY_NAME}`,
    );
    return ssh_keys[0]?.id;
  };

  const ensureSshKey = async (publicKey: string): Promise<number> => {
    const existing = await findSshKey();
    if (existing !== undefined) return existing;
    const res = await send("POST", "/ssh_keys", {
      name: SSH_KEY_NAME,
      public_key: publicKey,
      labels: MARKER_LABELS,
    });
    if (res.ok) return ((await res.json()) as { ssh_key: NamedDto }).ssh_key.id;
    if (res.status === 409) {
      // uniqueness_error: created concurrently (or same fingerprint) — reuse.
      const raced = await findSshKey();
      if (raced !== undefined) return raced;
    }
    return fail(res);
  };

  const defaultSize = async (): Promise<SizeInfo> => {
    const { server_types } = await request<{ server_types: ServerTypeDto[] }>(
      "GET",
      "/server_types?per_page=50",
    );
    const candidates = server_types.flatMap((st) => {
      if (st.cpu_type !== "shared" || st.memory < 2) return [];
      const loc = st.locations?.find((l) => l.name === LOCATION);
      if (!loc || loc.deprecation) return [];
      const price = st.prices.find((p) => p.location === LOCATION);
      if (!price) return [];
      return [{ st, monthly: Number(price.price_monthly.gross) }];
    });
    if (candidates.length === 0) {
      throw new CliError(
        `No suitable Hetzner server type found (shared vCPU, >= 2 GB RAM, ${LOCATION})`,
      );
    }
    const { st, monthly } = candidates.reduce((a, b) => (b.monthly < a.monthly ? b : a));
    return {
      id: st.name,
      description: `${st.name}: ${st.cores} shared vCPU, ${st.memory} GB RAM, ${st.disk} GB disk — price is gross (incl. VAT)`,
      priceMonthly: monthly.toFixed(2),
      currency: "EUR",
      region: LOCATION,
    };
  };

  const waitForRunning = async (created: ServerDto): Promise<CreatedVm> => {
    let server = created;
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      const ip = server.public_net.ipv4?.ip;
      if (server.status === "running" && ip) {
        return {
          id: String(server.id),
          ipv4: ip,
          size: server.server_type.name,
          region: server.location.name,
        };
      }
      await sleep(POLL_INTERVAL_MS);
      server = (await request<{ server: ServerDto }>("GET", `/servers/${server.id}`)).server;
    }
    throw new CliError(
      "Timed out waiting for the Hetzner server to come online",
      "Check the server in the Hetzner console; `aerial down` cleans up partial resources.",
    );
  };

  // 404 → already gone: `down` re-runs idempotently over partial teardowns.
  const deleteResource = async (path: string): Promise<void> => {
    const res = await send("DELETE", path);
    if (res.ok || res.status === 404) return;
    await fail(res);
  };

  const deleteFirewall = async (id: string): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      const res = await send("DELETE", `/firewalls/${id}`);
      if (res.ok || res.status === 404) return;
      // locked (423) / conflict (409) while the dying server still holds it.
      if ((res.status === 409 || res.status === 423) && attempt < FW_DELETE_RETRIES) {
        await sleep(FW_RETRY_MS);
        continue;
      }
      await fail(res);
    }
  };

  const listLabeledServers = async (): Promise<ServerDto[]> => {
    // Hetzner caps per_page at 50; stations beyond one page are cut (accepted).
    const { servers } = await request<{ servers: ServerDto[] }>(
      "GET",
      `/servers?label_selector=${encodeURIComponent(MARKER_SELECTOR)}&per_page=50`,
    );
    return servers;
  };

  return {
    id: "hetzner",
    displayName: "Hetzner",
    tokenHelp: TOKEN_HELP,

    async verifyToken(): Promise<boolean> {
      const res = await send("GET", "/locations?per_page=1");
      if (res.status === 401) return false;
      if (!res.ok) await fail(res);
      return true;
    },

    defaultSize,

    async provisionStation(input: CreateVmInput): Promise<CreatedVm> {
      const sshKeyId = await ensureSshKey(input.publicKey);
      const { firewall } = await request<{ firewall: NamedDto }>("POST", "/firewalls", {
        name: firewallName(input.domain),
        labels: MARKER_LABELS,
        rules: FIREWALL_RULES,
      });
      const size = input.size ?? (await defaultSize()).id;
      const { server } = await request<{ server: ServerDto }>("POST", "/servers", {
        name: input.domain,
        location: LOCATION,
        server_type: size,
        image: IMAGE,
        ssh_keys: [sshKeyId],
        firewalls: [{ firewall: firewall.id }],
        user_data: input.userData,
        labels: MARKER_LABELS,
      });
      return waitForRunning(server);
    },

    async createZone(domain: string): Promise<CreatedZone> {
      const { zone } = await request<{ zone: ZoneDto }>("POST", "/zones", {
        name: domain,
        mode: "primary",
        labels: MARKER_LABELS,
      });
      return {
        id: String(zone.id),
        // Assigned NS come back dot-terminated ("hydrogen.ns.hetzner.com.") —
        // strip for registrar UIs.
        nameservers: zone.authoritative_nameservers.assigned.map((ns) => ns.replace(/\.$/, "")),
      };
    },

    async createApexRecord(domain: string, ipv4: string): Promise<void> {
      // "@" addresses the zone apex; the path accepts the zone name (id_or_name).
      await request("POST", `/zones/${domain}/rrsets`, {
        name: "@",
        type: "A",
        records: [{ value: ipv4 }],
        labels: MARKER_LABELS,
      });
    },

    async listStations(): Promise<StationSummary[]> {
      const servers = await listLabeledServers();
      return servers.map((s) => ({
        domain: s.name,
        provider: "hetzner" as const,
        ipv4: s.public_net.ipv4?.ip ?? "",
        size: s.server_type.name,
        region: s.location.name,
        createdAt: s.created,
      }));
    },

    async discoverStationResources(domain: string): Promise<DestroyableResource[]> {
      const selector = encodeURIComponent(MARKER_SELECTOR);
      const out: DestroyableResource[] = [];

      const servers = await listLabeledServers();
      const server = servers.find((s) => s.name === domain);
      if (server) {
        out.push({
          kind: "vm",
          id: String(server.id),
          label: `VM ${server.server_type.name} (${server.location.city ?? server.location.name})`,
        });
      }

      const { firewalls } = await request<{ firewalls: NamedDto[] }>(
        "GET",
        `/firewalls?label_selector=${selector}&name=${encodeURIComponent(firewallName(domain))}`,
      );
      const fw = firewalls[0];
      if (fw) out.push({ kind: "firewall", id: String(fw.id), label: `Firewall ${fw.name}` });

      // Zones belong to a station by NAME, never by label (types.ts).
      const { zones } = await request<{ zones: NamedDto[] }>(
        "GET",
        `/zones?name=${encodeURIComponent(domain)}`,
      );
      const zone = zones.find((z) => z.name === domain);
      if (zone) out.push({ kind: "zone", id: String(zone.id), label: `DNS zone ${zone.name}` });

      // The ssh key is shared across the provider's stations — offer it only
      // when no OTHER labeled server remains (and only if we labeled it).
      if (!servers.some((s) => s.name !== domain)) {
        const { ssh_keys } = await request<{ ssh_keys: NamedDto[] }>(
          "GET",
          `/ssh_keys?label_selector=${selector}&name=${SSH_KEY_NAME}`,
        );
        const key = ssh_keys[0];
        if (key) {
          out.push({
            kind: "ssh-key",
            id: String(key.id),
            label: `SSH key ${key.name} (shared; no other stations left)`,
          });
        }
      }
      return out;
    },

    async destroyResources(resources: DestroyableResource[]): Promise<void> {
      const order: Record<DestroyableResource["kind"], number> = {
        vm: 0,
        firewall: 1,
        zone: 2,
        "ssh-key": 3,
      };
      const ordered = [...resources].sort((a, b) => order[a.kind] - order[b.kind]);
      for (const r of ordered) {
        switch (r.kind) {
          case "vm":
            await deleteResource(`/servers/${r.id}`);
            break;
          case "firewall":
            await deleteFirewall(r.id);
            break;
          case "zone":
            await deleteResource(`/zones/${r.id}`);
            break;
          case "ssh-key":
            await deleteResource(`/ssh_keys/${r.id}`);
            break;
        }
      }
    },
  };
}
