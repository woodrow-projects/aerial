import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliConfig } from "../config/schema";
import { CliError, type Prompter, type RunOpts, type Shell } from "../context";
import type { Paths } from "../paths";
import type { CloudProvider } from "../providers/types";
import type { StationConn } from "../ssh/transport";
import { PINNED_AERIAL_REF } from "../version";
import type { resolveStation } from "./resolve";
import { upgradeCommand } from "./upgrade";

const DOMAIN = "radio.example.com";
const IPV4 = "203.0.113.7";

const CONFIRM_MESSAGE = `Upgrade ${DOMAIN} to aerial ${PINNED_AERIAL_REF}? The stack rebuilds and restarts (a short stream interruption).`;

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

/** Scripted confirm queue that also asserts the prompt text it receives. */
function fakePrompter(confirmScript: Array<{ expectMessage: string; answer: boolean }>) {
  const queue = [...confirmScript];
  const notes: string[] = [];
  const outros: string[] = [];
  const confirmInitialValues: Array<boolean | undefined> = [];
  const prompter: Prompter = {
    intro() {},
    outro(message) {
      outros.push(message);
    },
    note(message) {
      notes.push(message);
    },
    async text(): Promise<never> {
      throw new Error("unexpected text");
    },
    async select(): Promise<never> {
      throw new Error("unexpected select");
    },
    async confirm(opts) {
      const next = queue.shift();
      if (!next) throw new Error(`unexpected confirm: ${opts.message}`);
      expect(opts.message).toBe(next.expectMessage);
      confirmInitialValues.push(opts.initialValue);
      return next.answer;
    },
    async password(): Promise<never> {
      throw new Error("unexpected password");
    },
    spinner() {
      return { start() {}, message() {}, stop() {} };
    },
  };
  return { prompter, notes, outros, confirmInitialValues, queue };
}

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
  const tmp = await mkdtemp(join(tmpdir(), "aerial-cli-upgrade-"));
  return { configDir: join(tmp, "cfg"), stationDir: join(tmp, "st"), backupsDir: join(tmp, "bk") };
}

const fetchStub = (async () => new Response("{}")) as typeof fetch;

describe("upgradeCommand", () => {
  it("confirms (default yes), then runs the staged upgrade script over ssh stdin", async () => {
    const paths = await tempPaths();
    const { shell, streams } = fakeShell(0);
    const { resolve, calls } = fakeResolve(paths);
    const { prompter, outros, confirmInitialValues } = fakePrompter([
      { expectMessage: CONFIRM_MESSAGE, answer: true },
    ]);

    await upgradeCommand({ prompter, shell, fetch: fetchStub, platform: "darwin", paths }, DOMAIN, { resolve });

    expect(calls.map((c) => c.domain)).toEqual([DOMAIN]);
    expect(confirmInitialValues).toEqual([true]);
    // One ssh stream: remote command is `bash -s`, the script rides stdin
    // (never argv) and stages the new release beside the old.
    expect(streams).toHaveLength(1);
    expect(streams[0].cmd).toBe("ssh");
    expect(streams[0].args.at(-1)).toBe("bash -s");
    expect(streams[0].args).toContain(`root@${IPV4}`);
    expect(streams[0].opts?.stdin).toContain("/opt/aerial.new");
    expect(outros).toHaveLength(1);
    expect(outros[0]).toContain(DOMAIN);
    expect(outros[0]).toContain(PINNED_AERIAL_REF);
  });

  it("declining the confirm leaves the station untouched", async () => {
    const paths = await tempPaths();
    const { shell, streams } = fakeShell(0);
    const { resolve } = fakeResolve(paths);
    const { prompter, notes, outros } = fakePrompter([{ expectMessage: CONFIRM_MESSAGE, answer: false }]);

    await upgradeCommand({ prompter, shell, fetch: fetchStub, platform: "darwin", paths }, DOMAIN, { resolve });

    expect(streams).toHaveLength(0);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/no changes/i);
    expect(outros).toHaveLength(0);
  });

  it("a failed remote upgrade surfaces as CliError, no success outro", async () => {
    const paths = await tempPaths();
    const { shell } = fakeShell(1);
    const { resolve } = fakeResolve(paths);
    const { prompter, outros } = fakePrompter([{ expectMessage: CONFIRM_MESSAGE, answer: true }]);

    await expect(
      upgradeCommand({ prompter, shell, fetch: fetchStub, platform: "darwin", paths }, DOMAIN, { resolve }),
    ).rejects.toThrowError(CliError);
    expect(outros).toHaveLength(0);
  });

  it("propagates resolve failures before asking anything", async () => {
    const paths = await tempPaths();
    const { shell, streams } = fakeShell(0);
    const { prompter, queue } = fakePrompter([]);
    const resolve = (async () => {
      throw new CliError("No station named nope.example.com found at any provider with a saved token.");
    }) as typeof resolveStation;

    await expect(
      upgradeCommand({ prompter, shell, fetch: fetchStub, platform: "darwin", paths }, "nope.example.com", { resolve }),
    ).rejects.toThrowError(CliError);
    expect(streams).toHaveLength(0);
    expect(queue).toHaveLength(0);
  });
});
