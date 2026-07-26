import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { CliConfig } from "../config/schema";
import { emptyConfig } from "../config/schema";
import { loadConfig, saveConfig } from "../config/store";
import type { Ctx, Prompter, RunOpts } from "../context";
import { CliError } from "../context";
import { knownHostsPath, type Paths } from "../paths";
import type { CloudProvider, DestroyableResource } from "../providers/types";
import { downCommand } from "./down";
import type { ResolvedStation } from "./resolve";

const DOMAIN = "radio.example.com";
const IPV4 = "203.0.113.7";
const NOW = () => new Date("2026-07-20T12:34:56Z");

// ---- fakes ----------------------------------------------------------------

type PromptStep =
  | { kind: "text"; expect: string | RegExp; answer: string }
  | { kind: "confirm"; expect: string | RegExp; answer: boolean; initialValue?: boolean };

/** Scripted prompter: each prompt consumes a step and asserts its message. */
function fakePrompter(steps: PromptStep[]) {
  const notes: Array<{ message: string; title?: string }> = [];
  const outros: string[] = [];
  const next = (kind: PromptStep["kind"]) => {
    const step = steps.shift();
    if (!step) throw new Error(`unexpected ${kind} prompt (script exhausted)`);
    expect(step.kind).toBe(kind);
    return step;
  };
  const match = (message: string, exp: string | RegExp) => {
    if (typeof exp === "string") expect(message).toContain(exp);
    else expect(message).toMatch(exp);
  };
  const prompter: Prompter = {
    intro() {},
    outro(message) {
      outros.push(message);
    },
    note(message, title) {
      notes.push({ message, title });
    },
    async text(opts) {
      const step = next("text") as Extract<PromptStep, { kind: "text" }>;
      match(opts.message, step.expect);
      return step.answer;
    },
    async select(): Promise<never> {
      throw new Error("unexpected select");
    },
    async confirm(opts) {
      const step = next("confirm") as Extract<PromptStep, { kind: "confirm" }>;
      match(opts.message, step.expect);
      if (step.initialValue !== undefined) expect(opts.initialValue).toBe(step.initialValue);
      return step.answer;
    },
    async password(): Promise<never> {
      throw new Error("unexpected password");
    },
    spinner() {
      return { start() {}, message() {}, stop() {} };
    },
  };
  return { prompter, notes, outros, steps };
}

interface ShellCall {
  via: "run" | "stream";
  cmd: string;
  args: string[];
  opts?: RunOpts;
}

/** Records every call in order; `code` decides each call's exit code. */
function fakeShell(code: (call: ShellCall) => number = () => 0) {
  const calls: ShellCall[] = [];
  return {
    calls,
    shell: {
      async run(cmd: string, args: string[], opts?: RunOpts) {
        const call: ShellCall = { via: "run", cmd, args, opts };
        calls.push(call);
        return { code: code(call), stdout: "", stderr: "" };
      },
      async runStreaming(cmd: string, args: string[], opts?: RunOpts) {
        const call: ShellCall = { via: "stream", cmd, args, opts };
        calls.push(call);
        return code(call);
      },
    },
  };
}

const resource = (over: Partial<DestroyableResource> = {}): DestroyableResource => ({
  kind: "vm",
  id: "42",
  label: "VM cpx11 (Falkenstein)",
  ...over,
});

function fakeProvider(resources: DestroyableResource[]) {
  const destroyed: DestroyableResource[][] = [];
  const provider: CloudProvider = {
    id: "hetzner",
    displayName: "Hetzner",
    tokenHelp: "",
    verifyToken: async () => true,
    defaultSize: async () => ({
      id: "cpx11",
      description: "",
      priceMonthly: "4.99",
      currency: "EUR",
      region: "fsn1",
    }),
    provisionStation: async () => ({ id: "1", ipv4: IPV4, size: "cpx11", region: "fsn1" }),
    createZone: async () => ({ id: "z", nameservers: [] }),
    createApexRecord: async () => {},
    listStations: async () => [],
    discoverStationResources: async () => resources,
    destroyResources: async (rs) => {
      destroyed.push(rs);
    },
  };
  return { provider, destroyed };
}

const fetchStub = (async () => new Response("{}")) as typeof fetch;

// ---- harness --------------------------------------------------------------

let tmp: string;
let paths: Paths;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "aerial-down-"));
  paths = {
    configDir: join(tmp, "cfg"),
    stationDir: join(tmp, "station"),
    backupsDir: join(tmp, "backups"),
  };
});

function makeCtx(prompter: Prompter, shell: ReturnType<typeof fakeShell>["shell"]): Ctx {
  return { prompter, shell, fetch: fetchStub, platform: "darwin", paths };
}

function resolved(
  provider: CloudProvider,
  cached?: ResolvedStation["cached"],
): () => Promise<ResolvedStation> {
  return async () => ({
    conn: { domain: DOMAIN, ipv4: IPV4, paths },
    provider,
    providerId: "hetzner",
    cached,
  });
}

const cachedEntry = (dnsMode: "delegation" | "a-record") => ({
  domain: DOMAIN,
  provider: "hetzner" as const,
  dnsMode,
  ipv4: IPV4,
  createdAt: "2026-07-01T00:00:00Z",
});

// ---- cloud ----------------------------------------------------------------

describe("downCommand — cloud", () => {
  it("errors when discovery finds nothing (hint: aerial ls)", async () => {
    const { provider } = fakeProvider([]);
    const { prompter } = fakePrompter([]);
    const { shell } = fakeShell();

    await expect(
      downCommand(makeCtx(prompter, shell), DOMAIN, { resolve: resolved(provider), now: NOW }),
    ).rejects.toMatchObject({
      name: "CliError",
      message: `Nothing found for ${DOMAIN}`,
      hint: expect.stringContaining("aerial ls"),
    });
  });

  it("lists resources + data-loss warning, then aborts on typed-confirm mismatch with nothing touched", async () => {
    const rs = [resource(), resource({ kind: "zone", id: "z1", label: `DNS zone ${DOMAIN}` })];
    const { provider, destroyed } = fakeProvider(rs);
    const { prompter, notes, outros } = fakePrompter([
      { kind: "text", expect: `Type ${DOMAIN} to confirm`, answer: "radio.example.co" },
    ]);
    const { shell, calls } = fakeShell();

    await downCommand(makeCtx(prompter, shell), DOMAIN, { resolve: resolved(provider), now: NOW });

    const warning = notes[0];
    expect(warning.message).toContain("VM cpx11 (Falkenstein)");
    expect(warning.message).toContain(`DNS zone ${DOMAIN}`);
    expect(warning.message).toMatch(/accounts/i);
    expect(warning.message).toMatch(/stream keys/i);
    expect(warning.message).toMatch(/listener history/i);
    expect(notes.some((n) => n.message === "Aborted — nothing was touched.")).toBe(true);
    expect(destroyed).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(outros).toHaveLength(0);
  });

  it("snapshot (default yes): compose down BEFORE scp, notes where the file landed, then destroys", async () => {
    const rs = [resource()];
    const { provider, destroyed } = fakeProvider(rs);
    const { prompter, notes, outros } = fakePrompter([
      { kind: "text", expect: `Type ${DOMAIN} to confirm`, answer: DOMAIN },
      {
        kind: "confirm",
        expect: "Download a copy of the station database first?",
        answer: true,
        initialValue: true,
      },
    ]);
    const { shell, calls } = fakeShell();

    await downCommand(makeCtx(prompter, shell), DOMAIN, {
      resolve: resolved(provider, cachedEntry("delegation")),
      now: NOW,
    });

    // Writers stopped first, only then the raw copy.
    expect(calls).toHaveLength(2);
    expect(calls[0].cmd).toBe("ssh");
    expect(calls[0].args.at(-1)).toContain("docker compose");
    expect(calls[0].args.at(-1)).toContain(" down");
    expect(calls[1].cmd).toBe("scp");
    const dest = join(paths.backupsDir, `${DOMAIN}-2026-07-20.db`);
    expect(calls[1].args.at(-2)).toBe(`root@${IPV4}:/var/lib/docker/volumes/aerial_data/_data/aerial.db`);
    expect(calls[1].args.at(-1)).toBe(dest);

    expect(notes.some((n) => n.message.includes(dest))).toBe(true);
    expect(destroyed).toEqual([rs]);
    expect(outros).toEqual([`${DOMAIN} destroyed.`]);
  });

  it("snapshot failure + declined continue aborts BEFORE destroyResources, says the station is down", async () => {
    const { provider, destroyed } = fakeProvider([resource()]);
    const { prompter, notes, outros } = fakePrompter([
      { kind: "text", expect: `Type ${DOMAIN} to confirm`, answer: DOMAIN },
      { kind: "confirm", expect: "Download a copy", answer: true },
      { kind: "confirm", expect: "Continue WITHOUT a snapshot?", answer: false, initialValue: false },
    ]);
    // scp fails; the compose-down already ran.
    const { shell } = fakeShell((c) => (c.cmd === "scp" ? 1 : 0));

    await downCommand(makeCtx(prompter, shell), DOMAIN, { resolve: resolved(provider), now: NOW });

    expect(destroyed).toHaveLength(0);
    expect(outros).toHaveLength(0);
    const abort = notes.find((n) => n.message.includes("nothing was destroyed"));
    expect(abort).toBeDefined();
    expect(abort?.message).toMatch(/down until/i); // honest: the panel is stopped now
  });

  it("compose-down failure also gates; accepted continue still destroys the discovered set", async () => {
    const rs = [resource(), resource({ kind: "firewall", id: "f", label: "Firewall aerial" })];
    const { provider, destroyed } = fakeProvider(rs);
    const { prompter } = fakePrompter([
      { kind: "text", expect: `Type ${DOMAIN} to confirm`, answer: DOMAIN },
      { kind: "confirm", expect: "Download a copy", answer: true },
      { kind: "confirm", expect: "Continue WITHOUT a snapshot?", answer: true },
    ]);
    const { shell, calls } = fakeShell((c) => (c.cmd === "ssh" ? 1 : 0));

    await downCommand(makeCtx(prompter, shell), DOMAIN, { resolve: resolved(provider), now: NOW });

    // compose down failed -> no scp attempted.
    expect(calls.filter((c) => c.cmd === "scp")).toHaveLength(0);
    expect(destroyed).toEqual([rs]);
  });

  it("dnsMode delegation: nameserver revert note", async () => {
    const { provider } = fakeProvider([resource()]);
    const { prompter, notes } = fakePrompter([
      { kind: "text", expect: `Type ${DOMAIN} to confirm`, answer: DOMAIN },
      { kind: "confirm", expect: "Download a copy", answer: false },
    ]);
    const { shell } = fakeShell();

    await downCommand(makeCtx(prompter, shell), DOMAIN, {
      resolve: resolved(provider, cachedEntry("delegation")),
      now: NOW,
    });

    const dns = notes.find((n) => n.message.includes("nameservers"));
    expect(dns?.message).toContain(`${DOMAIN} now points at nothing.`);
    expect(dns?.message).toContain("change its nameservers back at your registrar");
    expect(dns?.message).not.toContain("A record");
  });

  it("dnsMode a-record: dead-IP note", async () => {
    const { provider } = fakeProvider([resource()]);
    const { prompter, notes } = fakePrompter([
      { kind: "text", expect: `Type ${DOMAIN} to confirm`, answer: DOMAIN },
      { kind: "confirm", expect: "Download a copy", answer: false },
    ]);
    const { shell } = fakeShell();

    await downCommand(makeCtx(prompter, shell), DOMAIN, {
      resolve: resolved(provider, cachedEntry("a-record")),
      now: NOW,
    });

    const dns = notes.find((n) => n.message.includes("A record"));
    expect(dns?.message).toContain(`Remove the A record for ${DOMAIN} at your registrar`);
    expect(dns?.message).toContain("dead IP");
    expect(dns?.message).not.toContain("nameservers");
  });

  it("no cache entry: prints both DNS lines with their prefixes", async () => {
    const { provider } = fakeProvider([resource()]);
    const { prompter, notes } = fakePrompter([
      { kind: "text", expect: `Type ${DOMAIN} to confirm`, answer: DOMAIN },
      { kind: "confirm", expect: "Download a copy", answer: false },
    ]);
    const { shell } = fakeShell();

    await downCommand(makeCtx(prompter, shell), DOMAIN, {
      resolve: resolved(provider, undefined),
      now: NOW,
    });

    const dns = notes.find((n) => n.message.includes("If you delegated DNS"));
    expect(dns?.message).toContain("If you delegated DNS…:");
    expect(dns?.message).toContain("If you added an A record…:");
    expect(dns?.message).toContain("nameservers");
    expect(dns?.message).toContain("dead IP");
  });

  it("removes the cache entry and the station's known_hosts file", async () => {
    const cfg: CliConfig = {
      ...emptyConfig(),
      tokens: { hetzner: "tok" },
      stations: [cachedEntry("delegation"), { ...cachedEntry("a-record"), domain: "other.example.com" }],
    };
    await saveConfig(paths, cfg);
    const kh = knownHostsPath(paths, DOMAIN);
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(kh, "203.0.113.7 ssh-ed25519 AAAA...\n");

    const { provider } = fakeProvider([resource()]);
    const { prompter } = fakePrompter([
      { kind: "text", expect: `Type ${DOMAIN} to confirm`, answer: DOMAIN },
      { kind: "confirm", expect: "Download a copy", answer: false },
    ]);
    const { shell } = fakeShell();

    await downCommand(makeCtx(prompter, shell), DOMAIN, {
      resolve: resolved(provider, cachedEntry("delegation")),
      now: NOW,
    });

    const after = await loadConfig(paths);
    expect(after.stations.map((s) => s.domain)).toEqual(["other.example.com"]);
    expect(after.tokens.hetzner).toBe("tok"); // tokens survive
    await expect(access(kh)).rejects.toThrow(); // known_hosts gone
  });
});

// ---- local ----------------------------------------------------------------

describe("downCommand — local", () => {
  it("errors when there is no local station", async () => {
    const { prompter } = fakePrompter([]);
    const { shell } = fakeShell();

    await expect(downCommand(makeCtx(prompter, shell), "local", { now: NOW })).rejects.toMatchObject(
      { name: "CliError", message: "No local station on this machine" },
    );
  });

  it("typed-confirm mismatch aborts with nothing touched", async () => {
    const dir = join(tmp, "local-station");
    await saveConfig(paths, {
      ...emptyConfig(),
      localStation: { dir, createdAt: "2026-07-01T00:00:00Z" },
    });
    const { prompter, notes } = fakePrompter([
      { kind: "text", expect: "Type local to confirm", answer: "nope" },
    ]);
    const { shell, calls } = fakeShell();

    await downCommand(makeCtx(prompter, shell), "local", { now: NOW });

    expect(notes.some((n) => n.message === "Aborted — nothing was touched.")).toBe(true);
    expect(calls).toHaveLength(0);
    expect((await loadConfig(paths)).localStation?.dir).toBe(dir);
  });

  it("full flow: snapshot via helper container, down -v, rmrf, localStation cleared", async () => {
    const dir = join(tmp, "local-station");
    await saveConfig(paths, {
      ...emptyConfig(),
      localStation: { dir, createdAt: "2026-07-01T00:00:00Z" },
    });
    const { prompter, notes, outros } = fakePrompter([
      { kind: "text", expect: "Type local to confirm", answer: "local" },
      {
        kind: "confirm",
        expect: "Download a copy of the station database first?",
        answer: true,
        initialValue: true,
      },
    ]);
    const { shell, calls } = fakeShell();
    const removed: string[] = [];

    await downCommand(makeCtx(prompter, shell), "local", {
      now: NOW,
      rmrf: async (d) => {
        removed.push(d);
      },
    });

    const compose = ["compose", "-f", "deploy/docker-compose.yml", "--env-file", ".env"];
    expect(calls[0]).toMatchObject({
      via: "run",
      cmd: "docker",
      args: [...compose, "down"],
      opts: { cwd: dir },
    });
    // Volume lives inside Docker's VM on macOS — copy via bind-mounted helper.
    expect(calls[1]).toMatchObject({
      via: "run",
      cmd: "docker",
      args: [
        "run",
        "--rm",
        "-v",
        "aerial_data:/src",
        "-v",
        `${paths.backupsDir}:/dest`,
        "alpine",
        "cp",
        "/src/aerial.db",
        "/dest/local-2026-07-20.db",
      ],
    });
    expect(calls[2]).toMatchObject({
      via: "stream",
      cmd: "docker",
      args: [...compose, "down", "-v"],
      opts: { cwd: dir },
    });
    expect(notes.some((n) => n.message.includes(join(paths.backupsDir, "local-2026-07-20.db")))).toBe(true);
    expect(removed).toEqual([dir]);
    expect((await loadConfig(paths)).localStation).toBeNull();
    expect(outros).toHaveLength(1);
  });

  it("snapshot copy failure + declined continue aborts before down -v / rmrf", async () => {
    const dir = join(tmp, "local-station");
    await saveConfig(paths, {
      ...emptyConfig(),
      localStation: { dir, createdAt: "2026-07-01T00:00:00Z" },
    });
    const { prompter, notes } = fakePrompter([
      { kind: "text", expect: "Type local to confirm", answer: "local" },
      { kind: "confirm", expect: "Download a copy", answer: true },
      { kind: "confirm", expect: "Continue WITHOUT a snapshot?", answer: false, initialValue: false },
    ]);
    const removed: string[] = [];
    // Helper-container copy fails.
    const { shell, calls } = fakeShell((c) => (c.args[0] === "run" ? 1 : 0));

    await downCommand(makeCtx(prompter, shell), "local", {
      now: NOW,
      rmrf: async (d) => {
        removed.push(d);
      },
    });

    expect(calls.filter((c) => c.via === "stream")).toHaveLength(0); // no down -v
    expect(removed).toHaveLength(0);
    expect((await loadConfig(paths)).localStation?.dir).toBe(dir);
    expect(notes.some((n) => n.message.includes("nothing was destroyed"))).toBe(true);
  });

  it("propagates a CliError when down -v fails (data dir left in place)", async () => {
    const dir = join(tmp, "local-station");
    await saveConfig(paths, {
      ...emptyConfig(),
      localStation: { dir, createdAt: "2026-07-01T00:00:00Z" },
    });
    const { prompter } = fakePrompter([
      { kind: "text", expect: "Type local to confirm", answer: "local" },
      { kind: "confirm", expect: "Download a copy", answer: false },
    ]);
    const removed: string[] = [];
    const { shell } = fakeShell((c) => (c.via === "stream" ? 1 : 0));

    await expect(
      downCommand(makeCtx(prompter, shell), "local", {
        now: NOW,
        rmrf: async (d) => {
          removed.push(d);
        },
      }),
    ).rejects.toThrowError(CliError);
    expect(removed).toHaveLength(0);
    expect((await loadConfig(paths)).localStation?.dir).toBe(dir);
  });
});
