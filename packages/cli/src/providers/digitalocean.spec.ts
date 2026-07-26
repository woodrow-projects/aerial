import { describe, expect, it } from "vitest";
import { CliError } from "../context";
import { digitaloceanProvider } from "./digitalocean";
import type { CreateVmInput, DestroyableResource } from "./types";

const TOKEN = "tok_test";
const DOMAIN = "radio.example.com";
const FW_NAME = "aerial-radio-example-com";
const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAATESTKEY aerial";
const ALL = ["0.0.0.0/0", "::/0"];

type RouteResult = { status: number; body?: unknown };
type RouteHandler = (call: number, body: unknown, url: URL) => RouteResult;

interface RecordedCall {
  method: string;
  /** pathname + search, e.g. "/v2/droplets?tag_name=aerial&per_page=200" */
  path: string;
  auth: string | null;
  body: unknown;
}

const ok = (body: unknown, status = 200): RouteResult => ({ status, body });

/** Routes keyed "METHOD /v2/pathname"; handlers see a per-route call counter. */
function fakeApi(routes: Record<string, RouteHandler>) {
  const calls: RecordedCall[] = [];
  const counts = new Map<string, number>();
  const fn = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname + url.search, auth: headers.get("authorization"), body });
    const key = `${method} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unrouted request: ${key}`);
    const call = counts.get(key) ?? 0;
    counts.set(key, call + 1);
    const res = handler(call, body, url);
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status,
    });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

function fakeSleep() {
  const slept: number[] = [];
  return {
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
  };
}

function makeProvider(
  routes: Record<string, RouteHandler>,
  sleep?: (ms: number) => Promise<void>,
) {
  const { fn, calls } = fakeApi(routes);
  const provider = digitaloceanProvider({ token: TOKEN, fetch: fn, sleep });
  return { provider, calls };
}

const doDroplet = (over: Record<string, unknown> = {}) => ({
  id: 123,
  name: DOMAIN,
  status: "active",
  created_at: "2026-07-20T00:00:00Z",
  size_slug: "s-1vcpu-2gb",
  region: { slug: "nyc3" },
  networks: {
    v4: [
      { ip_address: "10.10.0.2", type: "private" },
      { ip_address: "203.0.113.7", type: "public" },
    ],
  },
  ...over,
});

const aerialKey = { id: 77, name: "aerial", fingerprint: "aa:bb", public_key: PUBLIC_KEY };

const vmInput = (over: Partial<CreateVmInput> = {}): CreateVmInput => ({
  domain: DOMAIN,
  publicKey: PUBLIC_KEY,
  userData: "#cloud-config\nruncmd: []\n",
  size: "s-1vcpu-2gb",
  ...over,
});

/** Routes for a full happy-path provision (key already uploaded). */
const provisionRoutes = (): Record<string, RouteHandler> => ({
  "POST /v2/tags": () => ok({ tag: { name: "aerial" } }, 201),
  "GET /v2/account/keys": () => ok({ ssh_keys: [aerialKey] }),
  "POST /v2/droplets": () => ok({ droplet: doDroplet({ status: "new", networks: { v4: [] } }) }, 202),
  "GET /v2/droplets/123": (call) =>
    call === 0
      ? ok({ droplet: doDroplet({ status: "new", networks: { v4: [] } }) })
      : ok({ droplet: doDroplet() }),
  "POST /v2/firewalls": () => ok({ firewall: { id: "fw-1", name: FW_NAME } }, 202),
});

const expectCliError = async (p: Promise<unknown>): Promise<CliError> => {
  const err = await p.then(
    () => {
      throw new Error("expected rejection");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(CliError);
  return err as CliError;
};

describe("digitaloceanProvider", () => {
  it("exposes id, displayName, and a console token walkthrough", () => {
    const { provider } = makeProvider({});
    expect(provider.id).toBe("digitalocean");
    expect(provider.displayName).toBe("DigitalOcean");
    expect(provider.tokenHelp).toContain("cloud.digitalocean.com");
    expect(provider.tokenHelp.toLowerCase()).toContain("token");
  });

  describe("verifyToken", () => {
    it("is true on 200 from /v2/account and sends the bearer token", async () => {
      const { provider, calls } = makeProvider({
        "GET /v2/account": () => ok({ account: { status: "active" } }),
      });
      await expect(provider.verifyToken()).resolves.toBe(true);
      expect(calls).toEqual([
        expect.objectContaining({ method: "GET", path: "/v2/account", auth: `Bearer ${TOKEN}` }),
      ]);
    });

    it("is false on 401 (no throw — used right after paste)", async () => {
      const { provider } = makeProvider({
        "GET /v2/account": () => ok({ id: "unauthorized" }, 401),
      });
      await expect(provider.verifyToken()).resolves.toBe(false);
    });
  });

  it("maps any 401 to a CliError about the token, with a hint", async () => {
    const { provider } = makeProvider({
      "GET /v2/sizes": () => ok({ id: "unauthorized", message: "Unable to authenticate" }, 401),
    });
    const err = await expectCliError(provider.defaultSize());
    expect(err.message).toBe("DigitalOcean rejected the API token");
    expect(err.hint).toBeTruthy();
  });

  describe("defaultSize", () => {
    it("picks the cheapest available >=2GB size offered in nyc3, live USD price", async () => {
      const { provider, calls } = makeProvider({
        "GET /v2/sizes": () =>
          ok({
            sizes: [
              { slug: "s-1vcpu-512mb-10gb", memory: 512, vcpus: 1, price_monthly: 4.0, regions: ["nyc3"], available: true, description: "Basic" },
              { slug: "s-1vcpu-2gb-cheap-unavail", memory: 2048, vcpus: 1, price_monthly: 6.0, regions: ["nyc3"], available: false, description: "Basic" },
              { slug: "s-1vcpu-2gb-fra-only", memory: 2048, vcpus: 1, price_monthly: 7.0, regions: ["fra1"], available: true, description: "Basic" },
              { slug: "s-1vcpu-2gb", memory: 2048, vcpus: 1, price_monthly: 12.0, regions: ["nyc1", "nyc3"], available: true, description: "Basic" },
              { slug: "s-2vcpu-4gb", memory: 4096, vcpus: 2, price_monthly: 24.0, regions: ["nyc3"], available: true, description: "Basic" },
            ],
          }),
      });
      const size = await provider.defaultSize();
      expect(size).toEqual({
        id: "s-1vcpu-2gb",
        description: expect.stringContaining("2 GB"),
        priceMonthly: "12.00",
        currency: "USD",
        region: "nyc3",
      });
      expect(calls[0]!.path).toContain("per_page=200");
    });

    it("throws CliError when nothing matches", async () => {
      const { provider } = makeProvider({ "GET /v2/sizes": () => ok({ sizes: [] }) });
      await expectCliError(provider.defaultSize());
    });
  });

  describe("provisionStation", () => {
    it("tags, reuses the existing key, creates the droplet, polls to active, firewalls it", async () => {
      const { slept, sleep } = fakeSleep();
      const { provider, calls } = makeProvider(provisionRoutes(), sleep);

      const vm = await provider.provisionStation(vmInput());

      expect(vm).toEqual({ id: "123", ipv4: "203.0.113.7", size: "s-1vcpu-2gb", region: "nyc3" });

      // marker tag created idempotently before anything is tagged with it
      expect(calls[0]).toEqual(
        expect.objectContaining({ method: "POST", path: "/v2/tags", body: { name: "aerial" } }),
      );

      // key reused — never re-uploaded
      expect(calls.some((c) => c.method === "POST" && c.path === "/v2/account/keys")).toBe(false);

      const create = calls.find((c) => c.method === "POST" && c.path === "/v2/droplets")!;
      expect(create.auth).toBe(`Bearer ${TOKEN}`);
      expect(create.body).toEqual({
        name: DOMAIN,
        region: "nyc3",
        size: "s-1vcpu-2gb",
        image: "ubuntu-24-04-x64",
        ssh_keys: [77],
        tags: ["aerial"],
        user_data: "#cloud-config\nruncmd: []\n",
      });

      // polled twice (new -> active), sleeping between polls
      const polls = calls.filter((c) => c.method === "GET" && c.path === "/v2/droplets/123");
      expect(polls).toHaveLength(2);
      expect(slept).toHaveLength(1);

      // firewall attached as soon as the droplet id exists — BEFORE the poll
      // loop, so the boot/cloud-init window is never open-ingress.
      const fw = calls.find((c) => c.method === "POST" && c.path === "/v2/firewalls")!;
      expect(calls.indexOf(fw)).toBeGreaterThan(calls.indexOf(create));
      expect(calls.indexOf(fw)).toBeLessThan(calls.indexOf(polls[0]));
      expect(fw.body).toEqual({
        name: FW_NAME,
        droplet_ids: [123],
        inbound_rules: [
          { protocol: "tcp", ports: "22", sources: { addresses: ALL } },
          { protocol: "tcp", ports: "80", sources: { addresses: ALL } },
          { protocol: "tcp", ports: "443", sources: { addresses: ALL } },
          { protocol: "udp", ports: "443", sources: { addresses: ALL } },
          { protocol: "tcp", ports: "8100-8110", sources: { addresses: ALL } },
        ],
        outbound_rules: [
          { protocol: "tcp", ports: "0", destinations: { addresses: ALL } },
          { protocol: "udp", ports: "0", destinations: { addresses: ALL } },
          { protocol: "icmp", destinations: { addresses: ALL } },
        ],
      });
    });

    it("uploads the key when absent; on 422 fingerprint-exists it re-fetches and reuses", async () => {
      const routes = provisionRoutes();
      routes["GET /v2/account/keys"] = (call) =>
        call === 0 ? ok({ ssh_keys: [] }) : ok({ ssh_keys: [{ ...aerialKey, id: 88 }] });
      routes["POST /v2/account/keys"] = () =>
        ok({ id: "unprocessable_entity", message: "SSH Key is already in use on your account" }, 422);
      const { provider, calls } = makeProvider(routes, fakeSleep().sleep);

      await provider.provisionStation(vmInput());

      const upload = calls.find((c) => c.method === "POST" && c.path === "/v2/account/keys")!;
      expect(upload.body).toEqual({ name: "aerial", public_key: PUBLIC_KEY });
      const create = calls.find((c) => c.method === "POST" && c.path === "/v2/droplets")!;
      expect((create.body as { ssh_keys: number[] }).ssh_keys).toEqual([88]);
    });

    it("falls back to defaultSize when no size override is given", async () => {
      const routes = provisionRoutes();
      routes["GET /v2/sizes"] = () =>
        ok({
          sizes: [
            { slug: "s-1vcpu-2gb", memory: 2048, vcpus: 1, price_monthly: 12.0, regions: ["nyc3"], available: true, description: "Basic" },
          ],
        });
      const { provider, calls } = makeProvider(routes, fakeSleep().sleep);

      await provider.provisionStation(vmInput({ size: undefined }));

      const create = calls.find((c) => c.method === "POST" && c.path === "/v2/droplets")!;
      expect((create.body as { size: string }).size).toBe("s-1vcpu-2gb");
    });
  });

  describe("DNS", () => {
    it("createZone posts the domain and returns DigitalOcean's fixed nameservers", async () => {
      const { provider, calls } = makeProvider({
        "POST /v2/domains": () => ok({ domain: { name: DOMAIN, ttl: null, zone_file: null } }, 201),
      });
      const zone = await provider.createZone(DOMAIN);
      expect(calls[0]!.body).toEqual({ name: DOMAIN });
      expect(zone).toEqual({
        id: DOMAIN,
        nameservers: ["ns1.digitalocean.com", "ns2.digitalocean.com", "ns3.digitalocean.com"],
      });
    });

    it("createApexRecord posts an apex A record with ttl 300", async () => {
      const { provider, calls } = makeProvider({
        [`POST /v2/domains/${DOMAIN}/records`]: () =>
          ok({ domain_record: { id: 1, type: "A", name: "@", data: "203.0.113.7" } }, 201),
      });
      await provider.createApexRecord(DOMAIN, "203.0.113.7");
      expect(calls[0]!.body).toEqual({ type: "A", name: "@", data: "203.0.113.7", ttl: 300 });
    });
  });

  describe("listStations", () => {
    it("queries by marker tag and maps droplets to station summaries", async () => {
      const { provider, calls } = makeProvider({
        "GET /v2/droplets": () =>
          ok({ droplets: [doDroplet(), doDroplet({ id: 456, name: "other.example.com", networks: { v4: [] } })] }),
      });
      const stations = await provider.listStations();
      expect(calls[0]!.path).toBe("/v2/droplets?tag_name=aerial&per_page=200");
      expect(stations).toEqual([
        {
          domain: DOMAIN,
          provider: "digitalocean",
          ipv4: "203.0.113.7",
          size: "s-1vcpu-2gb",
          region: "nyc3",
          createdAt: "2026-07-20T00:00:00Z",
        },
        expect.objectContaining({ domain: "other.example.com", ipv4: "" }),
      ]);
    });
  });

  describe("discoverStationResources", () => {
    const firewallList = () =>
      ok({
        firewalls: [
          { id: "fw-0", name: "unrelated" },
          { id: "fw-1", name: FW_NAME },
        ],
      });

    it("finds vm + firewall + zone, but keeps the shared key while another station remains", async () => {
      const { provider, calls } = makeProvider({
        "GET /v2/droplets": () =>
          ok({ droplets: [doDroplet(), doDroplet({ id: 456, name: "other.example.com" })] }),
        "GET /v2/firewalls": firewallList,
        [`GET /v2/domains/${DOMAIN}`]: () => ok({ domain: { name: DOMAIN } }),
      });
      const resources = await provider.discoverStationResources(DOMAIN);
      expect(resources.map((r) => [r.kind, r.id])).toEqual([
        ["vm", "123"],
        ["firewall", "fw-1"],
        ["zone", DOMAIN],
      ]);
      expect(calls.some((c) => c.path.startsWith("/v2/account/keys"))).toBe(false);
    });

    it("includes the shared ssh key when this is the last tagged station", async () => {
      const { provider } = makeProvider({
        "GET /v2/droplets": () => ok({ droplets: [doDroplet()] }),
        "GET /v2/firewalls": firewallList,
        [`GET /v2/domains/${DOMAIN}`]: () => ok({ id: "not_found" }, 404),
        "GET /v2/account/keys": () => ok({ ssh_keys: [aerialKey] }),
      });
      const resources = await provider.discoverStationResources(DOMAIN);
      expect(resources.map((r) => [r.kind, r.id])).toEqual([
        ["vm", "123"],
        ["firewall", "fw-1"],
        ["ssh-key", "77"],
      ]);
    });

    it("discovers partial sets (no vm left) — half-failed ups clean via the same path", async () => {
      const { provider } = makeProvider({
        "GET /v2/droplets": () => ok({ droplets: [] }),
        "GET /v2/firewalls": firewallList,
        [`GET /v2/domains/${DOMAIN}`]: () => ok({ id: "not_found" }, 404),
        "GET /v2/account/keys": () => ok({ ssh_keys: [aerialKey] }),
      });
      const resources = await provider.discoverStationResources(DOMAIN);
      expect(resources.map((r) => r.kind)).toEqual(["firewall", "ssh-key"]);
      for (const r of resources) expect(r.label).toBeTruthy();
    });
  });

  describe("destroyResources", () => {
    const resources: DestroyableResource[] = [
      { kind: "ssh-key", id: "77", label: "SSH key aerial" },
      { kind: "zone", id: DOMAIN, label: `DNS zone ${DOMAIN}` },
      { kind: "firewall", id: "fw-1", label: `Firewall ${FW_NAME}` },
      { kind: "vm", id: "123", label: "VM s-1vcpu-2gb (nyc3)" },
    ];

    it("deletes vm -> firewall -> zone -> ssh-key regardless of input order, 404s tolerated", async () => {
      const { provider, calls } = makeProvider({
        "DELETE /v2/droplets/123": () => ({ status: 204 }),
        "DELETE /v2/firewalls/fw-1": () => ({ status: 204 }),
        [`DELETE /v2/domains/${DOMAIN}`]: () => ok({ id: "not_found" }, 404), // already gone
        "DELETE /v2/account/keys/77": () => ({ status: 204 }),
      });
      await provider.destroyResources(resources);
      expect(calls.map((c) => c.path)).toEqual([
        "/v2/droplets/123",
        "/v2/firewalls/fw-1",
        `/v2/domains/${DOMAIN}`,
        "/v2/account/keys/77",
      ]);
      expect(calls.every((c) => c.method === "DELETE")).toBe(true);
    });

    it("works over a partial subset (idempotent down)", async () => {
      const { provider, calls } = makeProvider({
        "DELETE /v2/firewalls/fw-1": () => ok({ id: "not_found" }, 404),
        "DELETE /v2/account/keys/77": () => ({ status: 204 }),
      });
      await provider.destroyResources([resources[2]!, resources[0]!]);
      expect(calls.map((c) => c.path)).toEqual(["/v2/firewalls/fw-1", "/v2/account/keys/77"]);
    });

    it("surfaces non-404 delete failures as CliError", async () => {
      const { provider } = makeProvider({
        "DELETE /v2/droplets/123": () => ok({ id: "server_error", message: "boom" }, 500),
      });
      const err = await expectCliError(provider.destroyResources([resources[3]!]));
      expect(err.message).toMatch(/boom|500/);
    });
  });
});

describe("transport failures", () => {
  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof globalThis.fetch;

  it("wraps a fetch rejection in a friendly CliError instead of a raw stack", async () => {
    const provider = digitaloceanProvider({ token: TOKEN, fetch: offline });
    const err = await expectCliError(provider.listStations());
    expect(err.message).toContain("Could not reach the DigitalOcean API");
  });

  it("verifyToken surfaces network failure as CliError (distinct from a bad token)", async () => {
    const provider = digitaloceanProvider({ token: TOKEN, fetch: offline });
    await expectCliError(provider.verifyToken());
  });
});
