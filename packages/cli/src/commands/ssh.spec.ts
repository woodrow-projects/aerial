import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyConfig, type CliConfig } from "../config/schema";
import { saveConfig, upsertToken } from "../config/store";
import { CliError, type Prompter, type RunOpts, type Shell } from "../context";
import { knownHostsPath, privateKeyPath, type Paths } from "../paths";
import type { CloudProvider } from "../providers/types";
import type { StationConn } from "../ssh/transport";
import type { resolveStation } from "./resolve";
import { sshCommand } from "./ssh";

const DOMAIN = "radio.example.com";
const IPV4 = "203.0.113.7";

const provider: CloudProvider = {
  id: "hetzner",
  displayName: "Hetzner",
  tokenHelp: "",
  verifyToken: async () => true,
  defaultSize: async () => ({ id: "cpx11", description: "", priceMonthly: "4.99", currency: "EUR", region: "fsn1" }),
  provisionStation: async () => ({ id: "1", ipv4: IPV4, size: "cpx11", region: "fsn1" }),
  createZone: async () => ({ id: "z", nameservers: [] }),
  createApexRecord: async () => {},
  listStations: async () => [],
  discoverStationResources: async () => [],
  destroyResources: async () => {},
};

/** Any prompt is a failure — ssh's output IS the product. */
const mutePrompter: Prompter = {
  intro() {
    throw new Error("unexpected intro");
  },
  outro() {
    throw new Error("unexpected outro");
  },
  note() {
    throw new Error("unexpected note");
  },
  async text(): Promise<never> {
    throw new Error("unexpected text");
  },
  async select(): Promise<never> {
    throw new Error("unexpected select");
  },
  async confirm(): Promise<never> {
    throw new Error("unexpected confirm");
  },
  async password(): Promise<never> {
    throw new Error("unexpected password");
  },
  spinner() {
    throw new Error("unexpected spinner");
  },
};

function fakeShell(exitCode = 0) {
  const streams: Array<{ cmd: string; args: string[]; opts?: RunOpts }> = [];
  const shell: Shell = {
    async run(): Promise<never> {
      throw new Error("unexpected shell.run");
    },
    async runStreaming(cmd, args, opts) {
      streams.push({ cmd, args, opts });
      return exitCode;
    },
  };
  return { shell, streams };
}

function fakeResolve(paths: Paths) {
  const calls: Array<{ cfg: CliConfig; domain: string }> = [];
  const conn: StationConn = { domain: DOMAIN, ipv4: IPV4, paths };
  const resolve = (async (_ctx, cfg, domain) => {
    calls.push({ cfg, domain });
    return { conn, provider, providerId: "hetzner" as const };
  }) as typeof resolveStation;
  return { resolve, calls };
}

async function tempPaths(): Promise<Paths> {
  const tmp = await mkdtemp(join(tmpdir(), "aerial-cli-ssh-"));
  return { configDir: join(tmp, "cfg"), stationDir: join(tmp, "st"), backupsDir: join(tmp, "bk") };
}

const fetchStub = (async () => new Response("{}")) as typeof fetch;

describe("sshCommand", () => {
  it("resolves the station from the on-disk config and opens interactive ssh (-t, station identity)", async () => {
    const paths = await tempPaths();
    await saveConfig(paths, upsertToken(emptyConfig(), "hetzner", "tok"));
    const { shell, streams } = fakeShell(0);
    const { resolve, calls } = fakeResolve(paths);

    await sshCommand(
      { prompter: mutePrompter, shell, fetch: fetchStub, platform: "darwin", paths },
      DOMAIN,
      { resolve },
    );

    // The real config store fed the resolver.
    expect(calls).toEqual([{ cfg: expect.objectContaining({ tokens: { hetzner: "tok" } }), domain: DOMAIN }]);
    // Exact argv: identity + TOFU known_hosts, forced tty, no BatchMode (interactive).
    expect(streams).toEqual([
      {
        cmd: "ssh",
        args: [
          "-i",
          privateKeyPath(paths),
          "-o",
          `UserKnownHostsFile=${knownHostsPath(paths, DOMAIN)}`,
          "-o",
          "StrictHostKeyChecking=accept-new",
          "-o",
          "ConnectTimeout=10",
          "-t",
          `root@${IPV4}`,
        ],
        opts: undefined,
      },
    ]);
  });

  it("treats a non-zero ssh exit as normal (user typed exit / Ctrl-D)", async () => {
    const paths = await tempPaths();
    const { shell } = fakeShell(130);
    const { resolve } = fakeResolve(paths);

    await expect(
      sshCommand({ prompter: mutePrompter, shell, fetch: fetchStub, platform: "darwin", paths }, DOMAIN, { resolve }),
    ).resolves.toBeUndefined();
  });

  it("propagates resolve failures without touching ssh", async () => {
    const paths = await tempPaths();
    const { shell, streams } = fakeShell(0);
    const resolve = (async () => {
      throw new CliError("No station named nope.example.com found at any provider with a saved token.");
    }) as typeof resolveStation;

    await expect(
      sshCommand({ prompter: mutePrompter, shell, fetch: fetchStub, platform: "darwin", paths }, "nope.example.com", {
        resolve,
      }),
    ).rejects.toThrowError(CliError);
    expect(streams).toHaveLength(0);
  });
});
