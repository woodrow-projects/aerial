import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliConfig } from "../config/schema";
import { CliError, type Prompter, type RunOpts, type Shell } from "../context";
import { knownHostsPath, privateKeyPath, type Paths } from "../paths";
import type { CloudProvider } from "../providers/types";
import type { StationConn } from "../ssh/transport";
import { logsCommand } from "./logs";
import type { resolveStation } from "./resolve";

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

/** Any prompt is a failure — the log stream IS the product. */
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
  const tmp = await mkdtemp(join(tmpdir(), "aerial-cli-logs-"));
  return { configDir: join(tmp, "cfg"), stationDir: join(tmp, "st"), backupsDir: join(tmp, "bk") };
}

const fetchStub = (async () => new Response("{}")) as typeof fetch;

describe("logsCommand", () => {
  it("streams compose logs (follow, last 200 lines) over batch-mode ssh", async () => {
    const paths = await tempPaths();
    const { shell, streams } = fakeShell(0);
    const { resolve, calls } = fakeResolve(paths);

    await logsCommand(
      { prompter: mutePrompter, shell, fetch: fetchStub, platform: "darwin", paths },
      DOMAIN,
      { resolve },
    );

    expect(calls.map((c) => c.domain)).toEqual([DOMAIN]);
    // Exact argv: base (BatchMode) ssh + the compose logs line as ONE argv element.
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
          "-o",
          "BatchMode=yes",
          `root@${IPV4}`,
          "cd /opt/aerial && docker compose -f deploy/docker-compose.yml --env-file .env logs -f --tail=200",
        ],
        opts: undefined,
      },
    ]);
  });

  it("treats a non-zero exit as normal (Ctrl-C ends the stream with 130)", async () => {
    const paths = await tempPaths();
    const { shell } = fakeShell(130);
    const { resolve } = fakeResolve(paths);

    await expect(
      logsCommand({ prompter: mutePrompter, shell, fetch: fetchStub, platform: "darwin", paths }, DOMAIN, { resolve }),
    ).resolves.toBeUndefined();
  });

  it("propagates resolve failures without touching ssh", async () => {
    const paths = await tempPaths();
    const { shell, streams } = fakeShell(0);
    const resolve = (async () => {
      throw new CliError("No station named nope.example.com found at any provider with a saved token.");
    }) as typeof resolveStation;

    await expect(
      logsCommand({ prompter: mutePrompter, shell, fetch: fetchStub, platform: "darwin", paths }, "nope.example.com", {
        resolve,
      }),
    ).rejects.toThrowError(CliError);
    expect(streams).toHaveLength(0);
  });
});
