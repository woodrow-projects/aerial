import { CliError } from "../context";
import {
  MARKER_TAG,
  type CloudProvider,
  type CreatedVm,
  type CreatedZone,
  type CreateVmInput,
  type DestroyableResource,
  type ProviderDeps,
  type SizeInfo,
  type StationSummary,
} from "./types";

const BASE = "https://api.digitalocean.com/v2";
const REGION = "nyc3";
const IMAGE = "ubuntu-24-04-x64";
const ALL_V4_V6 = ["0.0.0.0/0", "::/0"];
// The domains API response carries no nameserver field — DO zones are always
// served by these three (docs + the NS records in the returned zone_file).
const NAMESERVERS = ["ns1.digitalocean.com", "ns2.digitalocean.com", "ns3.digitalocean.com"];

const POLL_INTERVAL_MS = 5000;
const POLL_ATTEMPTS = 60;

const TOKEN_HINT =
  "Mint a new personal access token (full read/write) at https://cloud.digitalocean.com/account/api/tokens and paste it again.";

// DO firewall names reject dots (unlike droplet names) — derive a
// deterministic per-station name so `down` can rediscover it.
const firewallName = (domain: string) => `aerial-${domain.replaceAll(".", "-")}`;

interface DoNetworkV4 {
  ip_address: string;
  type: "public" | "private";
}

interface DoDroplet {
  id: number;
  name: string;
  status: string;
  created_at: string;
  size_slug: string;
  region: { slug: string };
  networks: { v4: DoNetworkV4[] };
}

interface DoSize {
  slug: string;
  memory: number; // MB
  vcpus: number;
  price_monthly: number; // USD
  regions: string[];
  available: boolean;
  description: string;
}

interface DoSshKey {
  id: number;
  name: string;
  public_key: string;
}

const publicV4 = (d: DoDroplet): string | undefined =>
  d.networks?.v4?.find((n) => n.type === "public")?.ip_address;

export interface DigitalOceanDeps extends ProviderDeps {
  /** Delay between droplet polls — injected so specs run instantly. */
  sleep?: (ms: number) => Promise<void>;
}

export function digitaloceanProvider(deps: DigitalOceanDeps): CloudProvider {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const doFetch = async (
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<Response> => {
    let res: Response;
    try {
      res = await deps.fetch(`${BASE}${path}`, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${deps.token}`,
          "Content-Type": "application/json",
        },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new CliError(
        "Could not reach the DigitalOcean API",
        "Check your internet connection and try again.",
      );
    }
    if (res.status === 401) {
      throw new CliError("DigitalOcean rejected the API token", TOKEN_HINT);
    }
    return res;
  };

  const apiError = async (res: Response, what: string): Promise<CliError> => {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      // non-JSON error body — the status code will have to do
    }
    return new CliError(`DigitalOcean ${what} failed (${res.status}${detail ? `: ${detail}` : ""})`);
  };

  const request = async <T>(
    path: string,
    what: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> => {
    const res = await doFetch(path, init);
    if (!res.ok) throw await apiError(res, what);
    return (await res.json()) as T;
  };

  const listKeys = async (): Promise<DoSshKey[]> =>
    (await request<{ ssh_keys: DoSshKey[] }>("/account/keys?per_page=200", "ssh key list"))
      .ssh_keys;

  const findKey = (keys: DoSshKey[], publicKey: string): DoSshKey | undefined =>
    keys.find((k) => k.name === MARKER_TAG || k.public_key.trim() === publicKey.trim());

  const ensureSshKey = async (publicKey: string): Promise<number> => {
    const existing = findKey(await listKeys(), publicKey);
    if (existing) return existing.id;
    const res = await doFetch("/account/keys", {
      method: "POST",
      body: { name: MARKER_TAG, public_key: publicKey },
    });
    if (res.status === 422) {
      // fingerprint already registered (rename or racing upload) — reuse it
      const again = findKey(await listKeys(), publicKey);
      if (again) return again.id;
    }
    if (!res.ok) throw await apiError(res, "ssh key upload");
    return ((await res.json()) as { ssh_key: DoSshKey }).ssh_key.id;
  };

  const ensureMarkerTag = async (): Promise<void> => {
    const res = await doFetch("/tags", { method: "POST", body: { name: MARKER_TAG } });
    // 409/422 = tag already exists — idempotent create
    if (!res.ok && res.status !== 409 && res.status !== 422) {
      throw await apiError(res, "tag create");
    }
  };

  const taggedDroplets = async (): Promise<DoDroplet[]> =>
    // per_page caps at 200 — >200 stations on one account is out of scope
    (
      await request<{ droplets: DoDroplet[] }>(
        `/droplets?tag_name=${MARKER_TAG}&per_page=200`,
        "droplet list",
      )
    ).droplets;

  const waitForActive = async (id: number): Promise<DoDroplet> => {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(POLL_INTERVAL_MS);
      const { droplet } = await request<{ droplet: DoDroplet }>(
        `/droplets/${id}`,
        "droplet status",
      );
      if (droplet.status === "active" && publicV4(droplet)) return droplet;
    }
    throw new CliError(
      "Droplet did not become active in time",
      "Check https://cloud.digitalocean.com/droplets — `aerial down <domain>` cleans up partial resources.",
    );
  };

  const createFirewall = async (domain: string, dropletId: number): Promise<void> => {
    const inbound = (protocol: "tcp" | "udp", ports: string) => ({
      protocol,
      ports,
      sources: { addresses: ALL_V4_V6 },
    });
    await request(`/firewalls`, "firewall create", {
      method: "POST",
      body: {
        name: firewallName(domain),
        droplet_ids: [dropletId],
        inbound_rules: [
          inbound("tcp", "22"), // ssh
          inbound("tcp", "80"), // ACME http-01 + redirect
          inbound("tcp", "443"),
          inbound("udp", "443"), // HTTP/3
          inbound("tcp", "8100-8110"), // stream ingest
        ],
        outbound_rules: [
          // ports "0" = all ports (DO's spelling of allow-all)
          { protocol: "tcp", ports: "0", destinations: { addresses: ALL_V4_V6 } },
          { protocol: "udp", ports: "0", destinations: { addresses: ALL_V4_V6 } },
          { protocol: "icmp", destinations: { addresses: ALL_V4_V6 } },
        ],
      },
    });
  };

  const defaultSize = async (): Promise<SizeInfo> => {
    const { sizes } = await request<{ sizes: DoSize[] }>("/sizes?per_page=200", "size list");
    const candidates = sizes.filter(
      (s) => s.available && s.memory >= 2048 && s.regions.includes(REGION),
    );
    if (candidates.length === 0) {
      throw new CliError(
        `No available DigitalOcean size with 2 GB RAM in ${REGION}`,
        "Pass --size with a size slug from https://slugs.do-api.dev/",
      );
    }
    const best = candidates.reduce((a, b) => (b.price_monthly < a.price_monthly ? b : a));
    return {
      id: best.slug,
      description: `${best.vcpus} vCPU, ${best.memory / 1024} GB RAM (${best.description})`,
      priceMonthly: best.price_monthly.toFixed(2),
      currency: "USD",
      region: REGION,
    };
  };

  return {
    id: "digitalocean",
    displayName: "DigitalOcean",
    tokenHelp: [
      "1. Sign in (or sign up) at https://cloud.digitalocean.com",
      "2. Open https://cloud.digitalocean.com/account/api/tokens",
      "3. Generate New Token — name it 'aerial', Full Access (aerial creates",
      "   droplets, firewalls, and DNS), no expiry (or renew when it lapses)",
      "4. Copy the token (shown once) and paste it here",
    ].join("\n"),

    async verifyToken(): Promise<boolean> {
      // direct fetch: a 401 here means "bad paste, ask again", not a CliError —
      // but a transport failure is still a CliError (distinct from a bad token).
      let res: Response;
      try {
        res = await deps.fetch(`${BASE}/account`, {
          headers: { Authorization: `Bearer ${deps.token}` },
        });
      } catch {
        throw new CliError(
          "Could not reach the DigitalOcean API",
          "Check your internet connection and try again.",
        );
      }
      return res.ok;
    },

    defaultSize,

    async provisionStation(input: CreateVmInput): Promise<CreatedVm> {
      await ensureMarkerTag();
      const keyId = await ensureSshKey(input.publicKey);
      const size = input.size ?? (await defaultSize()).id;
      const created = await request<{ droplet: { id: number } }>("/droplets", "droplet create", {
        method: "POST",
        body: {
          name: input.domain, // name = station domain (identity — tags can't hold dots)
          region: REGION,
          size,
          image: IMAGE,
          ssh_keys: [keyId],
          tags: [MARKER_TAG],
          user_data: input.userData,
        },
      });
      // Firewall attaches as soon as the id exists — before the active-poll,
      // so the boot/cloud-init window is never exposed without one.
      await createFirewall(input.domain, created.droplet.id);
      const droplet = await waitForActive(created.droplet.id);
      return {
        id: String(droplet.id),
        ipv4: publicV4(droplet)!,
        size: droplet.size_slug,
        region: droplet.region.slug,
      };
    },

    async createZone(domain: string): Promise<CreatedZone> {
      await request("/domains", "zone create", { method: "POST", body: { name: domain } });
      return { id: domain, nameservers: NAMESERVERS };
    },

    async createApexRecord(domain: string, ipv4: string): Promise<void> {
      await request(`/domains/${domain}/records`, "apex record create", {
        method: "POST",
        body: { type: "A", name: "@", data: ipv4, ttl: 300 },
      });
    },

    async listStations(): Promise<StationSummary[]> {
      return (await taggedDroplets()).map((d) => ({
        domain: d.name,
        provider: "digitalocean" as const,
        ipv4: publicV4(d) ?? "", // "" while still provisioning
        size: d.size_slug,
        region: d.region.slug,
        createdAt: d.created_at,
      }));
    },

    async discoverStationResources(domain: string): Promise<DestroyableResource[]> {
      const resources: DestroyableResource[] = [];

      const droplets = await taggedDroplets();
      const vm = droplets.find((d) => d.name === domain);
      if (vm) {
        resources.push({
          kind: "vm",
          id: String(vm.id),
          label: `VM ${vm.size_slug} (${vm.region.slug})`,
        });
      }

      const { firewalls } = await request<{ firewalls: Array<{ id: string; name: string }> }>(
        "/firewalls?per_page=200",
        "firewall list",
      );
      const fw = firewalls.find((f) => f.name === firewallName(domain));
      if (fw) resources.push({ kind: "firewall", id: fw.id, label: `Firewall ${fw.name}` });

      // zone-by-name: the zone belongs to this station iff it exists
      const zoneRes = await doFetch(`/domains/${domain}`);
      if (zoneRes.ok) {
        resources.push({ kind: "zone", id: domain, label: `DNS zone ${domain}` });
      } else if (zoneRes.status !== 404) {
        throw await apiError(zoneRes, "zone lookup");
      }

      // the shared per-user key goes only with the provider's last station
      const others = droplets.filter((d) => d.name !== domain);
      if (others.length === 0) {
        const key = (await listKeys()).find((k) => k.name === MARKER_TAG);
        if (key) {
          resources.push({
            kind: "ssh-key",
            id: String(key.id),
            label: "SSH key 'aerial' (shared — this is the last station here)",
          });
        }
      }

      return resources;
    },

    async destroyResources(resources: DestroyableResource[]): Promise<void> {
      const order: Array<DestroyableResource["kind"]> = ["vm", "firewall", "zone", "ssh-key"];
      const pathFor = (r: DestroyableResource): string => {
        switch (r.kind) {
          case "vm":
            return `/droplets/${r.id}`;
          case "firewall":
            return `/firewalls/${r.id}`;
          case "zone":
            return `/domains/${r.id}`; // zone id = domain name
          case "ssh-key":
            return `/account/keys/${r.id}`;
        }
      };
      for (const kind of order) {
        for (const r of resources.filter((x) => x.kind === kind)) {
          const res = await doFetch(pathFor(r), { method: "DELETE" });
          // 404 = already gone — `down` must be idempotent over partial sets
          if (!res.ok && res.status !== 404) throw await apiError(res, `${r.kind} delete`);
        }
      }
    },
  };
}
