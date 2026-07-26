import { describe, expect, it } from "vitest";
import type { CliConfig } from "../config/schema";
import { emptyConfig } from "../config/schema";
import { CliError } from "../context";
import type { Paths } from "../paths";
import type { CloudProvider, StationSummary } from "../providers/types";
import { resolveStation } from "./resolve";

const paths: Paths = { configDir: "/t/cfg", stationDir: "/t/st", backupsDir: "/t/bk" };

const station = (over: Partial<StationSummary> = {}): StationSummary => ({
  domain: "radio.example.com",
  provider: "hetzner",
  ipv4: "203.0.113.7",
  size: "cpx11",
  region: "fsn1",
  createdAt: "2026-07-20T00:00:00Z",
  ...over,
});

function fakeProvider(stations: StationSummary[]): CloudProvider {
  return {
    id: "hetzner",
    displayName: "Hetzner",
    tokenHelp: "",
    verifyToken: async () => true,
    defaultSize: async () => ({ id: "cpx11", description: "", priceMonthly: "4.99", currency: "EUR", region: "fsn1" }),
    provisionStation: async () => ({ id: "1", ipv4: "203.0.113.7", size: "cpx11", region: "fsn1" }),
    createZone: async () => ({ id: "z", nameservers: [] }),
    createApexRecord: async () => {},
    listStations: async () => stations,
    discoverStationResources: async () => [],
    destroyResources: async () => {},
  };
}

const fetchStub = (async () => new Response("{}")) as typeof fetch;

describe("resolveStation", () => {
  it("resolves from the cache without querying providers", async () => {
    const cfg: CliConfig = {
      ...emptyConfig(),
      tokens: { hetzner: "tok" },
      stations: [{ domain: "radio.example.com", provider: "hetzner", dnsMode: "delegation", ipv4: "203.0.113.7", createdAt: "x" }],
    };
    let queried = false;
    const r = await resolveStation({ fetch: fetchStub, paths }, cfg, "radio.example.com", {
      makeProvider: () => {
        const p = fakeProvider([]);
        return { ...p, listStations: async () => ((queried = true), []) };
      },
    });
    expect(r.providerId).toBe("hetzner");
    expect(r.conn).toEqual({ domain: "radio.example.com", ipv4: "203.0.113.7", paths });
    expect(r.cached?.dnsMode).toBe("delegation");
    expect(queried).toBe(false);
  });

  it("falls back to label-query discovery across tokened providers (ADR D16)", async () => {
    const cfg: CliConfig = { ...emptyConfig(), tokens: { hetzner: "tok" } };
    const r = await resolveStation({ fetch: fetchStub, paths }, cfg, "radio.example.com", {
      makeProvider: () => fakeProvider([station()]),
    });
    expect(r.conn.ipv4).toBe("203.0.113.7");
    expect(r.cached).toBeUndefined();
  });

  it("throws CliError when the cached provider has no saved token", async () => {
    const cfg: CliConfig = {
      ...emptyConfig(),
      stations: [{ domain: "radio.example.com", provider: "hetzner", dnsMode: "a-record", ipv4: "1.2.3.4", createdAt: "x" }],
    };
    await expect(
      resolveStation({ fetch: fetchStub, paths }, cfg, "radio.example.com", { makeProvider: () => fakeProvider([]) }),
    ).rejects.toThrowError(CliError);
  });

  it("throws CliError when no provider knows the domain", async () => {
    const cfg: CliConfig = { ...emptyConfig(), tokens: { hetzner: "t", digitalocean: "t2" } };
    await expect(
      resolveStation({ fetch: fetchStub, paths }, cfg, "nope.example.com", { makeProvider: () => fakeProvider([station()]) }),
    ).rejects.toThrowError(/No station/);
  });
});

describe("resolveStation — degraded providers (review finding)", () => {
  it("a provider whose listStations fails is skipped, later providers still checked", async () => {
    const cfg: CliConfig = { ...emptyConfig(), tokens: { hetzner: "stale", digitalocean: "good" } };
    const r = await resolveStation({ fetch: fetchStub, paths }, cfg, "radio.example.com", {
      makeProvider: (id) => {
        const p = fakeProvider(id === "digitalocean" ? [station({ provider: "digitalocean" })] : []);
        if (id === "hetzner") {
          return { ...p, listStations: async () => { throw new CliError("Hetzner rejected the API token"); } };
        }
        return { ...p, id: "digitalocean" as const, displayName: "DigitalOcean" };
      },
    });
    expect(r.providerId).toBe("digitalocean");
    expect(r.conn.ipv4).toBe("203.0.113.7");
  });

  it("when nothing is found, providers that could not be checked are named in the error", async () => {
    const cfg: CliConfig = { ...emptyConfig(), tokens: { hetzner: "stale", digitalocean: "good" } };
    await expect(
      resolveStation({ fetch: fetchStub, paths }, cfg, "radio.example.com", {
        makeProvider: (id) => {
          const p = fakeProvider([]);
          if (id === "hetzner") {
            return { ...p, listStations: async () => { throw new CliError("Hetzner rejected the API token"); } };
          }
          return p;
        },
      }),
    ).rejects.toMatchObject({ name: "CliError", message: expect.stringContaining("hetzner") });
  });
});
