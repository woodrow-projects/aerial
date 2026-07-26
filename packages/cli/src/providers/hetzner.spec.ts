import { describe, expect, it } from "vitest";
import { CliError } from "../context";
import { hetznerProvider } from "./hetzner";
import type { DestroyableResource } from "./types";

/**
 * Fixtures mirror the live Cloud API (verified against
 * docs.hetzner.cloud/cloud.spec.json, 2026-07-20): zones/rrsets are the
 * migrated DNS endpoints, prices are decimal strings with net/gross, errors
 * are { error: { code, message } }.
 */

const TOKEN = "tok_test";
const DOMAIN = "radio.example.com";
const MARKER = { "managed-by": "aerial" };

interface Recorded {
  method: string;
  url: URL;
  auth: string | null;
  body?: any;
}
interface Reply {
  status: number;
  json?: unknown;
}
type Route = Reply | Reply[] | ((req: Recorded) => Reply);

/** Fake fetch keyed by "METHOD /v1/path". Reply arrays play in sequence
 *  (last one repeats); unstubbed routes throw. */
function fakeApi(routes: Record<string, Route>) {
  const calls: Recorded[] = [];
  const queues = new Map<string, Reply[]>();
  const fetchImpl = (async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const rec: Recorded = {
      method,
      url,
      auth: headers.get("authorization"),
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(rec);
    const key = `${method} ${url.pathname}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`unstubbed route: ${key}`);
    let reply: Reply;
    if (typeof route === "function") reply = route(rec);
    else if (Array.isArray(route)) {
      if (!queues.has(key)) queues.set(key, [...route]);
      const q = queues.get(key)!;
      reply = q.length > 1 ? q.shift()! : q[0]!;
    } else reply = route;
    return new Response(
      reply.json === undefined ? null : JSON.stringify(reply.json),
      { status: reply.status },
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function makeProvider(routes: Record<string, Route>) {
  const api = fakeApi(routes);
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const provider = hetznerProvider({ token: TOKEN, fetch: api.fetchImpl }, sleep);
  return { provider, calls: api.calls, sleeps };
}

const serverFixture = (over: Record<string, unknown> = {}) => ({
  id: 9001,
  name: DOMAIN,
  status: "running",
  created: "2026-07-20T10:00:00Z",
  labels: MARKER,
  public_net: { ipv4: { ip: "203.0.113.5", blocked: false, dns_ptr: "x" } },
  server_type: { name: "cpx11" },
  location: { name: "fsn1", city: "Falkenstein" },
  ...over,
});

describe("hetznerProvider", () => {
  it("exposes id, displayName, and a token walkthrough covering projects + KYC", () => {
    const { provider } = makeProvider({});
    expect(provider.id).toBe("hetzner");
    expect(provider.displayName).toBe("Hetzner");
    expect(provider.tokenHelp).toContain("project");
    expect(provider.tokenHelp.toLowerCase()).toContain("verif");
  });

  describe("verifyToken", () => {
    it("sends the bearer token and resolves true on 200", async () => {
      const { provider, calls } = makeProvider({
        "GET /v1/locations": { status: 200, json: { locations: [] } },
      });
      await expect(provider.verifyToken()).resolves.toBe(true);
      expect(calls[0]!.auth).toBe(`Bearer ${TOKEN}`);
    });

    it("resolves false on 401 without throwing", async () => {
      const { provider } = makeProvider({
        "GET /v1/locations": {
          status: 401,
          json: { error: { code: "unauthorized", message: "unable to authenticate" } },
        },
      });
      await expect(provider.verifyToken()).resolves.toBe(false);
    });

    it("throws CliError when the network is unreachable", async () => {
      const failing = (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;
      const provider = hetznerProvider({ token: TOKEN, fetch: failing });
      await expect(provider.verifyToken()).rejects.toBeInstanceOf(CliError);
    });
  });

  describe("401 handling everywhere else", () => {
    it("maps 401 to the rejected-token CliError with a minting hint", async () => {
      const { provider } = makeProvider({
        "GET /v1/servers": {
          status: 401,
          json: { error: { code: "unauthorized", message: "unable to authenticate" } },
        },
      });
      const err = await provider.listStations().catch((e) => e);
      expect(err).toBeInstanceOf(CliError);
      expect(err.message).toBe("Hetzner rejected the API token");
      expect(err.hint).toMatch(/token/i);
    });
  });

  describe("defaultSize", () => {
    it("picks the cheapest non-deprecated shared type with >= 2 GB in fsn1", async () => {
      const types = [
        // dedicated → skipped
        {
          name: "ccx13", cores: 2, memory: 8, disk: 80, cpu_type: "dedicated",
          prices: [{ location: "fsn1", price_monthly: { net: "10.92", gross: "12.99" } }],
          locations: [{ name: "fsn1", deprecation: null }],
        },
        // deprecated in fsn1 → skipped even though cheapest
        {
          name: "cx11", cores: 1, memory: 2, disk: 20, cpu_type: "shared",
          prices: [{ location: "fsn1", price_monthly: { net: "2.51", gross: "2.99" } }],
          locations: [{ name: "fsn1", deprecation: { announced: "2024-06-01T00:00:00Z", unavailable_after: "2024-09-01T00:00:00Z" } }],
        },
        // < 2 GB → skipped
        {
          name: "cpx-nano", cores: 1, memory: 1, disk: 20, cpu_type: "shared",
          prices: [{ location: "fsn1", price_monthly: { net: "3.24", gross: "3.85" } }],
          locations: [{ name: "fsn1", deprecation: null }],
        },
        // not offered in fsn1 → skipped
        {
          name: "cax11", cores: 2, memory: 4, disk: 40, cpu_type: "shared",
          prices: [{ location: "nbg1", price_monthly: { net: "3.19", gross: "3.79" } }],
          locations: [{ name: "nbg1", deprecation: null }],
        },
        // winner
        {
          name: "cpx11", cores: 2, memory: 2, disk: 40, cpu_type: "shared",
          prices: [{ location: "fsn1", price_monthly: { net: "4.35", gross: "5.18" } }],
          locations: [{ name: "fsn1", deprecation: null }],
        },
        // pricier → skipped
        {
          name: "cx32", cores: 4, memory: 8, disk: 80, cpu_type: "shared",
          prices: [{ location: "fsn1", price_monthly: { net: "6.80", gross: "8.09" } }],
          locations: [{ name: "fsn1", deprecation: null }],
        },
      ];
      const { provider } = makeProvider({
        "GET /v1/server_types": { status: 200, json: { server_types: types } },
      });
      const size = await provider.defaultSize();
      expect(size.id).toBe("cpx11");
      expect(size.priceMonthly).toBe("5.18");
      expect(size.currency).toBe("EUR");
      expect(size.region).toBe("fsn1");
      // net-vs-gross must be stated for the price shown.
      expect(size.description).toMatch(/gross|incl\. VAT/i);
    });

    it("throws CliError when nothing qualifies", async () => {
      const { provider } = makeProvider({
        "GET /v1/server_types": { status: 200, json: { server_types: [] } },
      });
      await expect(provider.defaultSize()).rejects.toBeInstanceOf(CliError);
    });
  });

  describe("provisionStation", () => {
    const input = {
      domain: DOMAIN,
      publicKey: "ssh-ed25519 AAAAC3Nz aerial",
      userData: "#cloud-config\n",
      size: "cpx11",
    };

    it("uploads the ssh key, creates a labeled firewall + server, and polls to running", async () => {
      const { provider, calls, sleeps } = makeProvider({
        "GET /v1/ssh_keys": { status: 200, json: { ssh_keys: [] } },
        "POST /v1/ssh_keys": { status: 201, json: { ssh_key: { id: 77, name: "aerial" } } },
        "POST /v1/firewalls": { status: 201, json: { firewall: { id: 55, name: `aerial-${DOMAIN}` } } },
        "POST /v1/servers": {
          status: 201,
          json: { server: serverFixture({ status: "initializing", public_net: { ipv4: null } }) },
        },
        "GET /v1/servers/9001": [
          { status: 200, json: { server: serverFixture({ status: "starting", public_net: { ipv4: null } }) } },
          { status: 200, json: { server: serverFixture() } },
        ],
      });

      const vm = await provider.provisionStation(input);
      expect(vm).toEqual({ id: "9001", ipv4: "203.0.113.5", size: "cpx11", region: "fsn1" });

      for (const c of calls) expect(c.auth).toBe(`Bearer ${TOKEN}`);

      const keyPost = calls.find((c) => c.method === "POST" && c.url.pathname === "/v1/ssh_keys")!;
      expect(keyPost.body).toEqual({ name: "aerial", public_key: input.publicKey, labels: MARKER });

      const fwPost = calls.find((c) => c.method === "POST" && c.url.pathname === "/v1/firewalls")!;
      expect(fwPost.body.name).toBe(`aerial-${DOMAIN}`);
      expect(fwPost.body.labels).toEqual(MARKER);
      const anywhere = ["0.0.0.0/0", "::/0"];
      expect(fwPost.body.rules).toEqual([
        { direction: "in", protocol: "tcp", port: "22", source_ips: anywhere },
        { direction: "in", protocol: "tcp", port: "80", source_ips: anywhere },
        { direction: "in", protocol: "tcp", port: "443", source_ips: anywhere },
        { direction: "in", protocol: "udp", port: "443", source_ips: anywhere },
        { direction: "in", protocol: "tcp", port: "8100-8110", source_ips: anywhere },
      ]);

      const srvPost = calls.find((c) => c.method === "POST" && c.url.pathname === "/v1/servers")!;
      expect(srvPost.body).toEqual({
        name: DOMAIN,
        location: "fsn1",
        server_type: "cpx11",
        image: "ubuntu-24.04",
        ssh_keys: [77],
        firewalls: [{ firewall: 55 }],
        user_data: input.userData,
        labels: MARKER,
      });

      // Two polls → slept between each.
      expect(sleeps.length).toBe(2);
    });

    it("reuses an existing 'aerial' ssh key without uploading", async () => {
      const { provider, calls } = makeProvider({
        "GET /v1/ssh_keys": { status: 200, json: { ssh_keys: [{ id: 31, name: "aerial" }] } },
        "POST /v1/firewalls": { status: 201, json: { firewall: { id: 55 } } },
        "POST /v1/servers": { status: 201, json: { server: serverFixture() } },
      });
      const vm = await provider.provisionStation(input);
      expect(vm.ipv4).toBe("203.0.113.5");
      expect(calls.some((c) => c.method === "POST" && c.url.pathname === "/v1/ssh_keys")).toBe(false);
      const srvPost = calls.find((c) => c.method === "POST" && c.url.pathname === "/v1/servers")!;
      expect(srvPost.body.ssh_keys).toEqual([31]);
    });

    it("recovers from a uniqueness_error race by re-fetching the key", async () => {
      const { provider, calls } = makeProvider({
        "GET /v1/ssh_keys": [
          { status: 200, json: { ssh_keys: [] } },
          { status: 200, json: { ssh_keys: [{ id: 31, name: "aerial" }] } },
        ],
        "POST /v1/ssh_keys": {
          status: 409,
          json: { error: { code: "uniqueness_error", message: "SSH key with the same fingerprint already exists" } },
        },
        "POST /v1/firewalls": { status: 201, json: { firewall: { id: 55 } } },
        "POST /v1/servers": { status: 201, json: { server: serverFixture() } },
      });
      await provider.provisionStation(input);
      const srvPost = calls.find((c) => c.method === "POST" && c.url.pathname === "/v1/servers")!;
      expect(srvPost.body.ssh_keys).toEqual([31]);
    });

    it("times out with CliError when the server never reaches running", async () => {
      const { provider } = makeProvider({
        "GET /v1/ssh_keys": { status: 200, json: { ssh_keys: [{ id: 31, name: "aerial" }] } },
        "POST /v1/firewalls": { status: 201, json: { firewall: { id: 55 } } },
        "POST /v1/servers": {
          status: 201,
          json: { server: serverFixture({ status: "initializing", public_net: { ipv4: null } }) },
        },
        "GET /v1/servers/9001": {
          status: 200,
          json: { server: serverFixture({ status: "initializing", public_net: { ipv4: null } }) },
        },
      });
      await expect(provider.provisionStation(input)).rejects.toBeInstanceOf(CliError);
    });
  });

  describe("createZone", () => {
    it("creates a labeled primary zone and returns its nameservers (trailing dots stripped)", async () => {
      const { provider, calls } = makeProvider({
        "POST /v1/zones": {
          status: 201,
          json: {
            zone: {
              id: 42,
              name: DOMAIN,
              status: "ok",
              authoritative_nameservers: {
                assigned: ["hydrogen.ns.hetzner.com.", "oxygen.ns.hetzner.com.", "helium.ns.hetzner.de."],
                delegated: [],
                delegation_last_check: null,
                delegation_status: "unknown",
              },
            },
          },
        },
      });
      const zone = await provider.createZone(DOMAIN);
      expect(zone).toEqual({
        id: "42",
        nameservers: ["hydrogen.ns.hetzner.com", "oxygen.ns.hetzner.com", "helium.ns.hetzner.de"],
      });
      expect(calls[0]!.body).toEqual({ name: DOMAIN, mode: "primary", labels: MARKER });
    });
  });

  describe("createApexRecord", () => {
    it("creates an '@' A rrset in the zone addressed by name", async () => {
      const { provider, calls } = makeProvider({
        [`POST /v1/zones/${DOMAIN}/rrsets`]: {
          status: 201,
          json: { rrset: { id: `${DOMAIN}/A`, name: "@", type: "A" } },
        },
      });
      await provider.createApexRecord(DOMAIN, "203.0.113.5");
      expect(calls[0]!.body).toEqual({
        name: "@",
        type: "A",
        records: [{ value: "203.0.113.5" }],
        labels: MARKER,
      });
    });
  });

  describe("listStations", () => {
    it("queries by label selector and maps servers to station summaries", async () => {
      const other = serverFixture({
        id: 9002,
        name: "beats.example.org",
        server_type: { name: "cx22" },
        public_net: { ipv4: null }, // still provisioning → empty ipv4
      });
      const { provider, calls } = makeProvider({
        "GET /v1/servers": { status: 200, json: { servers: [serverFixture(), other] } },
      });
      const stations = await provider.listStations();
      expect(stations).toEqual([
        {
          domain: DOMAIN,
          provider: "hetzner",
          ipv4: "203.0.113.5",
          size: "cpx11",
          region: "fsn1",
          createdAt: "2026-07-20T10:00:00Z",
        },
        {
          domain: "beats.example.org",
          provider: "hetzner",
          ipv4: "",
          size: "cx22",
          region: "fsn1",
          createdAt: "2026-07-20T10:00:00Z",
        },
      ]);
      const q = calls[0]!.url.searchParams;
      expect(q.get("label_selector")).toBe("managed-by=aerial");
      expect(q.get("per_page")).toBe("50");
    });
  });

  describe("discoverStationResources", () => {
    const fwList = { status: 200, json: { firewalls: [{ id: 55, name: `aerial-${DOMAIN}` }] } };
    const zoneList = { status: 200, json: { zones: [{ id: 42, name: DOMAIN }] } };

    it("finds vm + firewall + zone, but keeps the shared ssh key while other stations remain", async () => {
      const { provider, calls } = makeProvider({
        "GET /v1/servers": {
          status: 200,
          json: { servers: [serverFixture(), serverFixture({ id: 9002, name: "beats.example.org" })] },
        },
        "GET /v1/firewalls": fwList,
        "GET /v1/zones": zoneList,
      });
      const resources = await provider.discoverStationResources(DOMAIN);
      expect(resources).toEqual([
        { kind: "vm", id: "9001", label: "VM cpx11 (Falkenstein)" },
        { kind: "firewall", id: "55", label: `Firewall aerial-${DOMAIN}` },
        { kind: "zone", id: "42", label: `DNS zone ${DOMAIN}` },
      ]);
      // Not the last station → the shared key is never even looked up.
      expect(calls.some((c) => c.url.pathname === "/v1/ssh_keys")).toBe(false);
      const serverQ = calls.find((c) => c.url.pathname === "/v1/servers")!.url.searchParams;
      expect(serverQ.get("label_selector")).toBe("managed-by=aerial");
      const fwQ = calls.find((c) => c.url.pathname === "/v1/firewalls")!.url.searchParams;
      expect(fwQ.get("label_selector")).toBe("managed-by=aerial");
      expect(fwQ.get("name")).toBe(`aerial-${DOMAIN}`);
      const zoneQ = calls.find((c) => c.url.pathname === "/v1/zones")!.url.searchParams;
      expect(zoneQ.get("name")).toBe(DOMAIN);
    });

    it("includes the labeled ssh key when this is the last aerial server", async () => {
      const { provider, calls } = makeProvider({
        "GET /v1/servers": { status: 200, json: { servers: [serverFixture()] } },
        "GET /v1/firewalls": fwList,
        "GET /v1/zones": zoneList,
        "GET /v1/ssh_keys": { status: 200, json: { ssh_keys: [{ id: 77, name: "aerial" }] } },
      });
      const resources = await provider.discoverStationResources(DOMAIN);
      expect(resources.map((r) => r.kind)).toEqual(["vm", "firewall", "zone", "ssh-key"]);
      expect(resources[3]!.id).toBe("77");
      const keyQ = calls.find((c) => c.url.pathname === "/v1/ssh_keys")!.url.searchParams;
      expect(keyQ.get("label_selector")).toBe("managed-by=aerial");
      expect(keyQ.get("name")).toBe("aerial");
    });

    it("ignores zones whose name differs from the domain", async () => {
      const { provider } = makeProvider({
        "GET /v1/servers": { status: 200, json: { servers: [] } },
        "GET /v1/firewalls": { status: 200, json: { firewalls: [] } },
        "GET /v1/zones": { status: 200, json: { zones: [{ id: 43, name: "other.example.com" }] } },
        "GET /v1/ssh_keys": { status: 200, json: { ssh_keys: [] } },
      });
      await expect(provider.discoverStationResources(DOMAIN)).resolves.toEqual([]);
    });
  });

  describe("destroyResources", () => {
    const resources: DestroyableResource[] = [
      { kind: "ssh-key", id: "77", label: "SSH key aerial" },
      { kind: "zone", id: "42", label: `DNS zone ${DOMAIN}` },
      { kind: "vm", id: "9001", label: "VM cpx11 (Falkenstein)" },
      { kind: "firewall", id: "55", label: `Firewall aerial-${DOMAIN}` },
    ];

    it("deletes in vm -> firewall -> zone -> ssh-key order regardless of input order", async () => {
      const { provider, calls } = makeProvider({
        "DELETE /v1/servers/9001": { status: 200, json: { action: { id: 1 } } },
        "DELETE /v1/firewalls/55": { status: 204 },
        "DELETE /v1/zones/42": { status: 201, json: { action: { id: 2 } } },
        "DELETE /v1/ssh_keys/77": { status: 204 },
      });
      await provider.destroyResources(resources);
      expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
        "DELETE /v1/servers/9001",
        "DELETE /v1/firewalls/55",
        "DELETE /v1/zones/42",
        "DELETE /v1/ssh_keys/77",
      ]);
    });

    it("retries the firewall delete while the server teardown holds it (423/409)", async () => {
      const { provider, calls, sleeps } = makeProvider({
        "DELETE /v1/servers/9001": { status: 200, json: { action: { id: 1 } } },
        "DELETE /v1/firewalls/55": [
          { status: 423, json: { error: { code: "locked", message: "firewall is locked" } } },
          { status: 409, json: { error: { code: "conflict", message: "resource changed" } } },
          { status: 204 },
        ],
        "DELETE /v1/zones/42": { status: 201, json: { action: { id: 2 } } },
        "DELETE /v1/ssh_keys/77": { status: 204 },
      });
      await provider.destroyResources(resources);
      const fwCalls = calls.filter((c) => c.url.pathname === "/v1/firewalls/55");
      expect(fwCalls.length).toBe(3);
      expect(sleeps.length).toBe(2);
    });

    it("gives up with CliError when the firewall stays locked", async () => {
      const { provider, calls } = makeProvider({
        "DELETE /v1/firewalls/55": {
          status: 423,
          json: { error: { code: "locked", message: "firewall is locked" } },
        },
      });
      await expect(
        provider.destroyResources([{ kind: "firewall", id: "55", label: "Firewall" }]),
      ).rejects.toBeInstanceOf(CliError);
      // Initial attempt + bounded retries, not an infinite loop.
      expect(calls.length).toBeGreaterThan(1);
      expect(calls.length).toBeLessThanOrEqual(8);
    });

    it("treats 404 as already gone (idempotent re-run after partial teardown)", async () => {
      const { provider } = makeProvider({
        "DELETE /v1/servers/9001": {
          status: 404,
          json: { error: { code: "not_found", message: "server not found" } },
        },
      });
      await expect(
        provider.destroyResources([{ kind: "vm", id: "9001", label: "VM" }]),
      ).resolves.toBeUndefined();
    });
  });

  describe("API error surface", () => {
    it("wraps non-ok responses in CliError including the provider's code/message", async () => {
      const { provider } = makeProvider({
        "POST /v1/zones": {
          status: 422,
          json: { error: { code: "invalid_input", message: "name is invalid" } },
        },
      });
      const err = await provider.createZone("bad_domain").catch((e) => e);
      expect(err).toBeInstanceOf(CliError);
      expect(err.message).toContain("invalid_input");
      expect(err.message).toContain("name is invalid");
    });
  });
});
