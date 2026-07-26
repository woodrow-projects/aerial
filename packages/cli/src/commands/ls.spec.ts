import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConfig, type CliConfig } from "../config/schema";
import { saveConfig } from "../config/store";
import type { Ctx, Prompter, Shell } from "../context";
import type { Paths } from "../paths";
import type { CloudProvider, ProviderId, StationSummary } from "../providers/types";
import { lsCommand } from "./ls";

// ls never prompts and never shells out — any use is a bug.
const noPrompts: Prompter = {
  intro: () => {
    throw new Error("unexpected prompt: intro");
  },
  outro: () => {
    throw new Error("unexpected prompt: outro");
  },
  note: () => {
    throw new Error("unexpected prompt: note");
  },
  text: async () => {
    throw new Error("unexpected prompt: text");
  },
  select: async () => {
    throw new Error("unexpected prompt: select");
  },
  confirm: async () => {
    throw new Error("unexpected prompt: confirm");
  },
  password: async () => {
    throw new Error("unexpected prompt: password");
  },
  spinner: () => {
    throw new Error("unexpected prompt: spinner");
  },
};

const noShell: Shell = {
  run: async () => {
    throw new Error("unexpected shell.run");
  },
  runStreaming: async () => {
    throw new Error("unexpected shell.runStreaming");
  },
};

const noFetch = (async () => {
  throw new Error("unexpected ctx.fetch");
}) as typeof fetch;

const station = (over: Partial<StationSummary> = {}): StationSummary => ({
  domain: "radio.example.com",
  provider: "hetzner",
  ipv4: "203.0.113.7",
  size: "cpx11",
  region: "fsn1",
  createdAt: "2026-07-20T00:00:00Z",
  ...over,
});

function fakeProvider(
  id: ProviderId,
  displayName: string,
  list: () => Promise<StationSummary[]>,
): CloudProvider {
  return {
    id,
    displayName,
    tokenHelp: "",
    verifyToken: async () => true,
    defaultSize: async () => ({
      id: "s",
      description: "",
      priceMonthly: "0",
      currency: "EUR",
      region: "r",
    }),
    provisionStation: async () => ({ id: "1", ipv4: "0.0.0.0", size: "s", region: "r" }),
    createZone: async () => ({ id: "z", nameservers: [] }),
    createApexRecord: async () => {},
    listStations: list,
    discoverStationResources: async () => [],
    destroyResources: async () => {},
  };
}

let tmp: string;

async function pathsWith(cfg: CliConfig): Promise<Paths> {
  tmp = await mkdtemp(join(tmpdir(), "aerial-ls-"));
  const paths: Paths = {
    configDir: join(tmp, "cfg"),
    stationDir: join(tmp, "station"),
    backupsDir: join(tmp, "backups"),
  };
  await saveConfig(paths, cfg);
  return paths;
}

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const ctxWith = (paths: Paths, fetchFn: typeof fetch = noFetch): Ctx => ({
  prompter: noPrompts,
  shell: noShell,
  fetch: fetchFn,
  platform: "darwin",
  paths,
});

describe("lsCommand", () => {
  it("lists provider stations and the local station in aligned columns", async () => {
    const cfg: CliConfig = {
      ...emptyConfig(),
      tokens: { hetzner: "tok" },
      localStation: { dir: "/data/station", createdAt: "2026-07-20T00:00:00Z" },
    };
    const paths = await pathsWith(cfg);
    const lines: string[] = [];
    const probed: string[] = [];

    await lsCommand(ctxWith(paths), {
      makeProvider: (id) =>
        fakeProvider(id, "Hetzner", async () => [station()]),
      probe: async (_fetchFn, url) => {
        probed.push(url);
        return url.includes("localhost") ? "unreachable" : "up";
      },
      print: (line) => lines.push(line),
    });

    const header = lines[0];
    for (const col of ["DOMAIN", "PROVIDER", "REGION", "SIZE", "IP", "STATUS"]) {
      expect(header).toContain(col);
    }

    const cloudRow = lines.find((l) => l.includes("radio.example.com"));
    expect(cloudRow).toBeDefined();
    for (const cell of ["Hetzner", "fsn1", "cpx11", "203.0.113.7", "up"]) {
      expect(cloudRow).toContain(cell);
    }

    const localRow = lines.find((l) => l.startsWith("local"));
    expect(localRow).toBeDefined();
    expect(localRow).toContain("this machine");
    expect(localRow).toContain("unreachable");

    // padEnd alignment: each column starts at the same index in every line.
    expect(cloudRow!.indexOf("Hetzner")).toBe(header!.indexOf("PROVIDER"));
    expect(localRow!.indexOf("this machine")).toBe(header!.indexOf("PROVIDER"));
    expect(cloudRow!.indexOf("up")).toBe(header!.indexOf("STATUS"));

    expect(probed).toContain("https://radio.example.com/");
    expect(probed).toContain("http://localhost/");
  });

  it("degrades a throwing provider to a note row without crashing the listing", async () => {
    const cfg: CliConfig = {
      ...emptyConfig(),
      tokens: { hetzner: "tok", digitalocean: "tok2" },
    };
    const paths = await pathsWith(cfg);
    const lines: string[] = [];

    await lsCommand(ctxWith(paths), {
      makeProvider: (id) =>
        id === "hetzner"
          ? fakeProvider(id, "Hetzner", async () => [station()])
          : fakeProvider(id, "DigitalOcean", async () => {
              throw new Error("API token rejected");
            }),
      probe: async () => "up",
      print: (line) => lines.push(line),
    });

    expect(lines.find((l) => l.includes("radio.example.com"))).toBeDefined();
    expect(
      lines.find((l) => l === "DigitalOcean: could not reach (API token rejected)"),
    ).toBeDefined();
    expect(lines.find((l) => l.includes("No stations yet"))).toBeUndefined();
  });

  it("prints the friendly empty message when there are no tokens and no local station", async () => {
    const paths = await pathsWith(emptyConfig());
    const lines: string[] = [];

    await lsCommand(ctxWith(paths), {
      makeProvider: () => {
        throw new Error("no provider should be constructed");
      },
      probe: async () => {
        throw new Error("nothing to probe");
      },
      print: (line) => lines.push(line),
    });

    expect(lines).toEqual(["No stations yet — create one with: aerial up"]);
  });

  it("prints the same empty message when tokened providers report zero stations", async () => {
    const cfg: CliConfig = { ...emptyConfig(), tokens: { hetzner: "tok" } };
    const paths = await pathsWith(cfg);
    const lines: string[] = [];

    await lsCommand(ctxWith(paths), {
      makeProvider: (id) => fakeProvider(id, "Hetzner", async () => []),
      probe: async () => {
        throw new Error("nothing to probe");
      },
      print: (line) => lines.push(line),
    });

    expect(lines).toEqual(["No stations yet — create one with: aerial up"]);
  });

  it("default probe: any HTTP response is up, a fetch rejection is unreachable", async () => {
    const cfg: CliConfig = { ...emptyConfig(), tokens: { hetzner: "tok" } };
    const paths = await pathsWith(cfg);
    const lines: string[] = [];

    const fetchFn = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url === "https://bad-gateway.example.com/")
        return new Response("bad", { status: 502 });
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    await lsCommand(ctxWith(paths, fetchFn), {
      makeProvider: (id) =>
        fakeProvider(id, "Hetzner", async () => [
          station({ domain: "bad-gateway.example.com" }),
          station({ domain: "dead.example.com", ipv4: "203.0.113.8" }),
        ]),
      print: (line) => lines.push(line),
    });

    expect(lines.find((l) => l.startsWith("bad-gateway.example.com"))).toContain("up");
    expect(lines.find((l) => l.startsWith("dead.example.com"))).toContain("unreachable");
  });
});
