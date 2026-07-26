import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyConfig } from "../config/schema";
import { loadConfig, saveConfig } from "../config/store";
import type { Ctx, Prompter, RunOpts } from "../context";
import { privateKeyPath, publicKeyPath, type Paths } from "../paths";
import type {
  CloudProvider,
  CreateVmInput,
  DestroyableResource,
  ProviderDeps,
  ProviderId,
} from "../providers/types";
import { PINNED_AERIAL_REF } from "../version";
import { upCommand, validateDomain } from "./up";

const IPV4 = "203.0.113.7";
const APEX = "example.com";
const SUB = "radio.example.com";
const NOW = () => new Date("2026-07-21T09:00:00Z");
const NOW_ISO = "2026-07-21T09:00:00.000Z";
const NS = ["hydrogen.ns.hetzner.com", "oxygen.ns.hetzner.com"];
const PUBKEY = "ssh-ed25519 AAAATEST aerial-cli";
const DELEGATION_FIRST = "aerial manages DNS — change nameservers once (recommended)";
const ARECORD_FIRST = "keep DNS where it is — add one A record (recommended)";
/** Succeeds only if the check passes on attempt 1 (sleep is instant anyway). */
const FAST = { timeoutMs: 1_000, intervalMs: 1 };
/** One attempt, then the poll reports failure. */
const INSTANT_TIMEOUT = { timeoutMs: 0, intervalMs: 1 };
const sleepNever = async () => {};

// ---- fakes ----------------------------------------------------------------

type PromptStep =
  | { kind: "text"; expect: string | RegExp; answer: string; initialValue?: string }
  | { kind: "confirm"; expect: string | RegExp; answer: boolean; initialValue?: boolean }
  | { kind: "password"; expect: string | RegExp; answer: string }
  | { kind: "select"; expect: string | RegExp; answer: string; expectFirstLabel?: string };

/** Scripted prompter: each prompt consumes a step and asserts its message. */
function fakePrompter(steps: PromptStep[]) {
  const notes: Array<{ message: string; title?: string }> = [];
  const outros: string[] = [];
  const spinners: string[] = [];
  const next = <K extends PromptStep["kind"]>(kind: K): Extract<PromptStep, { kind: K }> => {
    const step = steps.shift();
    if (!step) throw new Error(`unexpected ${kind} prompt (script exhausted)`);
    expect(step.kind).toBe(kind);
    return step as Extract<PromptStep, { kind: K }>;
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
      const step = next("text");
      match(opts.message, step.expect);
      if (step.initialValue !== undefined) expect(opts.initialValue).toBe(step.initialValue);
      // Scripted answers must pass the prompt's own validation.
      expect(opts.validate?.(step.answer)).toBeUndefined();
      return step.answer;
    },
    async select<T extends string>(opts: {
      message: string;
      options: Array<{ value: T; label: string; hint?: string }>;
    }): Promise<T> {
      const step = next("select");
      match(opts.message, step.expect);
      if (step.expectFirstLabel !== undefined) expect(opts.options[0]?.label).toBe(step.expectFirstLabel);
      expect(opts.options.map((o) => o.value)).toContain(step.answer);
      return step.answer as T;
    },
    async confirm(opts) {
      const step = next("confirm");
      match(opts.message, step.expect);
      if (step.initialValue !== undefined) expect(opts.initialValue).toBe(step.initialValue);
      return step.answer;
    },
    async password(opts) {
      const step = next("password");
      match(opts.message, step.expect);
      expect(opts.validate?.(step.answer)).toBeUndefined();
      return step.answer;
    },
    spinner() {
      return {
        start(m: string) {
          spinners.push(m);
        },
        message(m: string) {
          spinners.push(m);
        },
        stop(m?: string) {
          if (m) spinners.push(m);
        },
      };
    },
  };
  return { prompter, notes, outros, spinners, steps };
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

const TYPE_CODE: Record<string, number> = { A: 1, AAAA: 28, MX: 15, NS: 2 };

/**
 * URL-routed fetch: DoH answers come from a (mutable) `name TYPE` -> data
 * table, rdap.org serves `rdapBody` (404 when absent), codeload serves bytes.
 */
function fakeFetch(dns: Record<string, string[]>, rdapBody?: unknown): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.startsWith("https://dns.google/resolve")) {
      const u = new URL(url);
      const name = u.searchParams.get("name") ?? "";
      const type = u.searchParams.get("type") ?? "";
      const data = dns[`${name} ${type}`] ?? [];
      return Response.json({ Status: 0, Answer: data.map((d) => ({ type: TYPE_CODE[type], data: d })) });
    }
    if (url.startsWith("https://rdap.org/")) {
      return rdapBody === undefined ? new Response("not found", { status: 404 }) : Response.json(rdapBody);
    }
    if (url.startsWith("https://codeload.github.com/")) {
      return new Response("tarball-bytes");
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

interface HarnessOpts {
  verify?: (token: string) => boolean;
  nameservers?: string[];
  resources?: DestroyableResource[];
  /** Runs inside provisionStation — e.g. to make the A record resolvable. */
  onProvision?: (input: CreateVmInput) => void;
}

/** Fake provider factory recording every call (and the token each was built with). */
function providerHarness(opts: HarnessOpts = {}) {
  const calls: string[] = [];
  const madeTokens: string[] = [];
  const provisionInputs: CreateVmInput[] = [];
  const destroyed: DestroyableResource[][] = [];
  let zoneSawCache: boolean | null = null;
  const resources: DestroyableResource[] = opts.resources ?? [
    { kind: "vm", id: "vm1", label: "VM cpx11 (Falkenstein)" },
    { kind: "zone", id: "z1", label: `DNS zone ${APEX}` },
  ];
  const makeProvider = (id: ProviderId, deps: ProviderDeps): CloudProvider => {
    madeTokens.push(deps.token);
    const token = deps.token;
    return {
      id,
      displayName: "Hetzner",
      tokenHelp:
        "Console -> project -> Security -> API tokens -> Generate (Read & Write). New accounts can take a day to verify.",
      async verifyToken() {
        calls.push("verifyToken");
        return (opts.verify ?? (() => true))(token);
      },
      async defaultSize() {
        calls.push("defaultSize");
        return { id: "cpx11", description: "2 vCPU, 2 GB RAM", priceMonthly: "4.99", currency: "EUR", region: "Falkenstein" };
      },
      async provisionStation(input) {
        calls.push("provisionStation");
        provisionInputs.push(input);
        opts.onProvision?.(input);
        return { id: "vm1", ipv4: IPV4, size: input.size ?? "cpx11", region: "Falkenstein" };
      },
      async createZone(domain) {
        calls.push("createZone");
        // Was the station already cached (Ctrl-C safety) when DNS work began?
        zoneSawCache = (await loadConfig(paths)).stations.some((s) => s.domain === domain);
        return { id: "z1", nameservers: opts.nameservers ?? NS };
      },
      async createApexRecord(domain, ipv4) {
        calls.push(`createApexRecord:${domain}:${ipv4}`);
      },
      async listStations() {
        calls.push("listStations");
        return [];
      },
      async discoverStationResources() {
        calls.push("discoverStationResources");
        return resources;
      },
      async destroyResources(rs) {
        calls.push("destroyResources");
        destroyed.push(rs);
      },
    };
  };
  return { makeProvider, calls, madeTokens, provisionInputs, destroyed, resources, zoneSawCache: () => zoneSawCache };
}

// ---- step builders --------------------------------------------------------

const modeStep = (answer: "cloud" | "local"): PromptStep => ({
  kind: "select",
  expect: "Where should this station run",
  answer,
  expectFirstLabel: "On a cloud VM (recommended)",
});
const providerStep: PromptStep = {
  kind: "select",
  expect: "provider",
  answer: "hetzner",
  expectFirstLabel: "Hetzner — cheapest bandwidth (recommended)",
};
const tokenStep = (answer: string): PromptStep => ({
  kind: "password",
  expect: "Paste your Hetzner API token",
  answer,
});
const domainStep = (domain: string): PromptStep => ({ kind: "text", expect: "domain", answer: domain });
const inUseStep = (domain: string, answer = false): PromptStep => ({
  kind: "confirm",
  expect: `Is ${domain} used for anything else`,
  answer,
});
const dnsStep = (answer: "delegation" | "a-record", expectFirstLabel: string): PromptStep => ({
  kind: "select",
  expect: "DNS",
  answer,
  expectFirstLabel,
});
const priceConfirm = (answer: boolean): PromptStep => ({
  kind: "confirm",
  expect: "Hetzner cpx11, 4.99 EUR/mo + egress, Falkenstein — create the VM?",
  answer,
});
const adminSteps = (email = "op@example.com", pw = "hunter2secure"): PromptStep[] => [
  { kind: "text", expect: "Admin email", answer: email },
  { kind: "text", expect: "display name", answer: "Op", initialValue: "Operator" },
  { kind: "password", expect: "admin password", answer: pw },
  { kind: "password", expect: "again", answer: pw },
];
const acmeStep = (initial = "op@example.com", answer = "certs@example.com"): PromptStep => ({
  kind: "text",
  expect: "TLS certificate",
  answer,
  initialValue: initial,
});

// ---- harness --------------------------------------------------------------

let tmp: string;
let paths: Paths;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "aerial-up-"));
  paths = {
    configDir: join(tmp, "cfg"),
    stationDir: join(tmp, "station"),
    backupsDir: join(tmp, "backups"),
  };
});

function makeCtx(prompter: Prompter, shell: Ctx["shell"], fetchFn: typeof fetch): Ctx {
  return { prompter, shell, fetch: fetchFn, platform: "darwin", paths };
}

/** Pre-seed the ssh keypair so ensureKeypair takes its reuse path. */
async function seedKeys() {
  await mkdir(paths.configDir, { recursive: true });
  await writeFile(privateKeyPath(paths), "PRIVATE");
  await writeFile(publicKeyPath(paths), `${PUBKEY}\n`);
}

const savedToken = () => saveConfig(paths, { ...emptyConfig(), tokens: { hetzner: "tok" } });

// ---- domain validation ----------------------------------------------------

describe("validateDomain", () => {
  it("accepts plain lowercase hostnames with a dot", () => {
    expect(validateDomain("example.com")).toBeUndefined();
    expect(validateDomain("radio.example.com")).toBeUndefined();
    expect(validateDomain("my-radio.example.co.uk")).toBeUndefined();
  });

  it("rejects uppercase, spaces, schemes, missing dots and bad labels", () => {
    expect(validateDomain("")).toBeTruthy();
    expect(validateDomain("Example.com")).toBeTruthy();
    expect(validateDomain("radio example.com")).toBeTruthy();
    expect(validateDomain("https://example.com")).toBeTruthy();
    expect(validateDomain("example.com/path")).toBeTruthy();
    expect(validateDomain("example")).toBeTruthy();
    expect(validateDomain("ra_dio.example.com")).toBeTruthy();
    expect(validateDomain("-bad.example.com")).toBeTruthy();
    expect(validateDomain("bad..example.com")).toBeTruthy();
  });
});

// ---- local ----------------------------------------------------------------

describe("upCommand — local", () => {
  it("happy path: docker check, prompts (password mismatch re-asks), tarball into stationDir, installer env, config + outro", async () => {
    const { prompter, notes, outros, spinners, steps } = fakePrompter([
      modeStep("local"),
      { kind: "text", expect: "Admin email", answer: "op@example.com" },
      { kind: "text", expect: "display name", answer: "Operator Op", initialValue: "Operator" },
      { kind: "password", expect: "admin password", answer: "first-password" },
      { kind: "password", expect: "again", answer: "different-password" },
      { kind: "password", expect: "admin password", answer: "hunter2secure" },
      { kind: "password", expect: "again", answer: "hunter2secure" },
    ]);
    const { shell, calls } = fakeShell();

    await upCommand(makeCtx(prompter, shell, fakeFetch({})), {}, { now: NOW });

    expect(notes.some((n) => n.message.includes("didn't match"))).toBe(true);

    // Docker presence verified before anything else runs.
    expect(calls[0]).toMatchObject({ cmd: "docker", args: ["--version"] });
    expect(calls[1]).toMatchObject({ cmd: "docker", args: ["compose", "version"] });

    expect(spinners.some((s) => s.includes(`Downloading aerial ${PINNED_AERIAL_REF}`))).toBe(true);
    const tarIdx = calls.findIndex((c) => c.cmd === "tar");
    const installIdx = calls.findIndex((c) => c.cmd === "bash");
    expect(calls[tarIdx]?.args).toContain(paths.stationDir);
    expect(tarIdx).toBeLessThan(installIdx);

    // The collected answers land on install.sh as env vars, nothing else.
    const install = calls[installIdx];
    expect(install).toMatchObject({ via: "stream", cmd: "bash", args: ["deploy/install.sh"] });
    expect(install?.opts?.cwd).toBe(paths.stationDir);
    expect(install?.opts?.env).toEqual({
      SITE_ADDRESS: ":80",
      ACME_EMAIL: "",
      PUBLIC_BASE_URL: "http://localhost",
      ADMIN_EMAIL: "op@example.com",
      ADMIN_NAME: "Operator Op",
      ADMIN_PASSWORD: "hunter2secure",
    });

    expect((await loadConfig(paths)).localStation).toEqual({ dir: paths.stationDir, createdAt: NOW_ISO });
    expect(outros.at(-1)).toContain("http://localhost");
    expect(outros.at(-1)).toContain("aerial ls");
    expect(outros.at(-1)).toContain("aerial down local");
    expect(steps).toHaveLength(0);
  });

  it("refuses when a local station already exists", async () => {
    await saveConfig(paths, {
      ...emptyConfig(),
      localStation: { dir: "/somewhere", createdAt: "2026-07-01T00:00:00Z" },
    });
    const { prompter } = fakePrompter([modeStep("local")]);
    const { shell, calls } = fakeShell();

    await expect(
      upCommand(makeCtx(prompter, shell, fakeFetch({})), {}, { now: NOW }),
    ).rejects.toMatchObject({
      name: "CliError",
      message: "A local station already exists",
      hint: expect.stringContaining("aerial down local"),
    });
    // Only the two docker presence checks ran — nothing downloaded or installed.
    expect(calls).toHaveLength(2);
  });
});

// ---- cloud ----------------------------------------------------------------

describe("upCommand — cloud", () => {
  it("delegation happy path: provision before zone, cache before DNS wait, secrets stay out of provider calls", async () => {
    await seedKeys();
    const dns = { [`${APEX} NS`]: [NS[0]] };
    const rdap = {
      entities: [
        {
          roles: ["registrar"],
          vcardArray: ["vcard", [["fn", {}, "text", "Namecheap"]]],
          links: [{ rel: "related", href: "https://www.namecheap.com" }],
        },
      ],
    };
    const h = providerHarness();
    const { prompter, notes, outros, spinners, steps } = fakePrompter([
      modeStep("cloud"),
      providerStep,
      tokenStep("tok-good"),
      domainStep(APEX),
      inUseStep(APEX),
      dnsStep("delegation", DELEGATION_FIRST),
      priceConfirm(true),
      ...adminSteps(),
      acmeStep(),
    ]);
    const { shell, calls: shellCalls } = fakeShell();

    await upCommand(makeCtx(prompter, shell, fakeFetch(dns, rdap)), {}, {
      makeProvider: h.makeProvider,
      now: NOW,
      sleep: sleepNever,
      dnsPoll: FAST,
      sshPoll: FAST,
    });

    // Order: VM exists before any DNS resource (the cloud-init overlap trick).
    expect(h.calls).toEqual([
      "verifyToken",
      "defaultSize",
      "provisionStation",
      "createZone",
      `createApexRecord:${APEX}:${IPV4}`,
    ]);
    // Cache was on disk by the time zone creation started (Ctrl-C safety).
    expect(h.zoneSawCache()).toBe(true);

    const cfg = await loadConfig(paths);
    expect(cfg.tokens.hetzner).toBe("tok-good");
    expect(cfg.stations).toEqual([
      { domain: APEX, provider: "hetzner", dnsMode: "delegation", ipv4: IPV4, createdAt: NOW_ISO },
    ]);

    // No secret ever reaches a provider call; user-data carries none either.
    const providerArgs = JSON.stringify(h.provisionInputs);
    expect(providerArgs).not.toContain("hunter2secure");
    expect(providerArgs).not.toContain("certs@example.com");
    expect(h.provisionInputs[0]).toMatchObject({ domain: APEX, publicKey: PUBKEY, size: "cpx11" });

    // Nameserver note: exact values, registrar hint, patience line.
    const nsNote = notes.find((n) => n.message.includes(NS[0]));
    expect(nsNote?.message).toContain(NS[1]);
    expect(nsNote?.message).toContain("replace the nameservers");
    expect(nsNote?.message).toContain("Namecheap");
    expect(nsNote?.message).toContain("I'll wait");

    // Poll ticks surface on the spinner.
    expect(spinners.some((s) => s.includes("(check 1)"))).toBe(true);

    // Keys were reused (no ssh-keygen); install streams with secrets on stdin, never argv.
    expect(shellCalls.some((c) => c.cmd === "ssh-keygen")).toBe(false);
    const sshCalls = shellCalls.filter((c) => c.cmd === "ssh");
    expect(sshCalls[0]).toMatchObject({ via: "run" }); // reachability probe first
    expect(sshCalls[0]?.args.at(-1)).toBe("true");
    const install = shellCalls.find((c) => c.via === "stream" && c.cmd === "ssh");
    expect(install?.args.at(-1)).toBe("bash -s");
    expect(install?.opts?.stdin).toContain("export ADMIN_PASSWORD='hunter2secure'");
    expect(install?.opts?.stdin).toContain("export SITE_ADDRESS='example.com'");
    expect(install?.opts?.stdin).toContain("export PUBLIC_BASE_URL='https://example.com'");
    expect(install?.opts?.stdin).toContain("export ACME_EMAIL='certs@example.com'");
    expect(install?.args.join(" ")).not.toContain("hunter2secure");

    expect(outros.at(-1)).toContain(`https://${APEX}`);
    expect(outros.at(-1)).toContain("aerial ls");
    expect(outros.at(-1)).toContain(`aerial logs ${APEX}`);
    expect(outros.at(-1)).toContain(`aerial down ${APEX}`);
    expect(steps).toHaveLength(0);
  });

  it("a-record path: subdomain recommends a-record first, no zone created, exact record note", async () => {
    await seedKeys();
    await savedToken();
    const dns: Record<string, string[]> = {};
    // The record only resolves once the VM exists and the user added it.
    const h = providerHarness({ onProvision: () => (dns[`${SUB} A`] = [IPV4]) });
    const { prompter, notes, outros, steps } = fakePrompter([
      modeStep("cloud"),
      providerStep,
      domainStep(SUB),
      inUseStep(SUB),
      dnsStep("a-record", ARECORD_FIRST),
      priceConfirm(true),
      ...adminSteps(),
      acmeStep(),
    ]);
    const { shell } = fakeShell();

    await upCommand(makeCtx(prompter, shell, fakeFetch(dns)), {}, {
      makeProvider: h.makeProvider,
      now: NOW,
      sleep: sleepNever,
      dnsPoll: FAST,
      sshPoll: FAST,
    });

    // Saved token verified, never re-prompted (no password step consumed).
    expect(h.calls[0]).toBe("verifyToken");
    expect(h.calls).not.toContain("createZone");
    expect(h.calls.some((c) => c.startsWith("createApexRecord"))).toBe(false);

    const recordNote = notes.find((n) => n.message.includes("add this record"));
    expect(recordNote?.message).toContain(`${SUB}  A  ${IPV4}`);
    expect(recordNote?.message).toContain("your DNS host"); // rdap knew nothing

    expect((await loadConfig(paths)).stations[0]).toMatchObject({ domain: SUB, dnsMode: "a-record" });
    expect(outros.at(-1)).toContain(`https://${SUB}`);
    expect(steps).toHaveLength(0);
  });

  it("in-use guard: probe hit puts a-record first; insisting on delegation warns, declining falls back to a-record", async () => {
    await seedKeys();
    await savedToken();
    const dns = { [`${APEX} A`]: ["198.51.100.9", IPV4] };
    const h = providerHarness();
    const { prompter, notes } = fakePrompter([
      modeStep("cloud"),
      providerStep,
      domainStep(APEX),
      inUseStep(APEX, false), // user says no — the probe already said yes
      dnsStep("delegation", ARECORD_FIRST), // a-record recommended, user insists
      { kind: "confirm", expect: `Delegate ${APEX} anyway?`, answer: false, initialValue: false },
      priceConfirm(true),
      ...adminSteps(),
      acmeStep(),
    ]);
    const { shell } = fakeShell();

    await upCommand(makeCtx(prompter, shell, fakeFetch(dns)), {}, {
      makeProvider: h.makeProvider,
      now: NOW,
      sleep: sleepNever,
      dnsPoll: FAST,
      sshPoll: FAST,
    });

    // Blast-radius warning listed the probe hits.
    const warn = notes.find((n) => n.message.includes("198.51.100.9"));
    expect(warn?.message).toContain("stop working");
    // Declining the override means a-record end to end.
    expect(h.calls).not.toContain("createZone");
    expect((await loadConfig(paths)).stations[0]).toMatchObject({ domain: APEX, dnsMode: "a-record" });
  });

  it("token retry: bad paste re-prompts with help shown, good token saved before anything is created", async () => {
    const h = providerHarness({ verify: (t) => t === "tok-good" });
    const { prompter, notes, outros } = fakePrompter([
      modeStep("cloud"),
      providerStep,
      tokenStep("tok-bad"),
      tokenStep("tok-good"),
      domainStep(APEX),
      inUseStep(APEX),
      dnsStep("delegation", DELEGATION_FIRST),
      priceConfirm(false), // stop here — the token must already be on disk
    ]);
    const { shell } = fakeShell();

    await upCommand(makeCtx(prompter, shell, fakeFetch({})), {}, {
      makeProvider: h.makeProvider,
      now: NOW,
      sleep: sleepNever,
      dnsPoll: FAST,
      sshPoll: FAST,
    });

    expect(notes.some((n) => n.message.includes("API tokens"))).toBe(true); // tokenHelp shown
    expect(h.calls.filter((c) => c === "verifyToken")).toHaveLength(2);
    expect((await loadConfig(paths)).tokens.hetzner).toBe("tok-good");
    expect(h.calls).not.toContain("provisionStation");
    expect(outros).toEqual(["Nothing was created."]);
  });

  it("three bad tokens abort with a CliError and save nothing", async () => {
    const h = providerHarness({ verify: () => false });
    const { prompter } = fakePrompter([
      modeStep("cloud"),
      providerStep,
      tokenStep("t1"),
      tokenStep("t2"),
      tokenStep("t3"),
    ]);
    const { shell } = fakeShell();

    await expect(
      upCommand(makeCtx(prompter, shell, fakeFetch({})), {}, {
        makeProvider: h.makeProvider,
        now: NOW,
        sleep: sleepNever,
        dnsPoll: FAST,
        sshPoll: FAST,
      }),
    ).rejects.toMatchObject({ name: "CliError", message: expect.stringContaining("3") });

    expect(h.calls.filter((c) => c === "verifyToken")).toHaveLength(3);
    expect((await loadConfig(paths)).tokens.hetzner).toBeUndefined();
  });

  it("declining the price confirm creates nothing at all", async () => {
    await savedToken();
    const h = providerHarness();
    const { prompter, outros } = fakePrompter([
      modeStep("cloud"),
      providerStep,
      domainStep(APEX),
      inUseStep(APEX),
      dnsStep("delegation", DELEGATION_FIRST),
      priceConfirm(false),
    ]);
    const { shell, calls } = fakeShell();

    await upCommand(makeCtx(prompter, shell, fakeFetch({})), {}, {
      makeProvider: h.makeProvider,
      now: NOW,
      sleep: sleepNever,
      dnsPoll: FAST,
      sshPoll: FAST,
    });

    expect(h.calls).toEqual(["verifyToken", "defaultSize"]); // zero resources touched
    expect(calls).toHaveLength(0); // no keygen, no ssh
    expect(outros).toEqual(["Nothing was created."]);
    expect((await loadConfig(paths)).stations).toHaveLength(0);
  });

  it("--size is used verbatim: no price lookup, a heads-up note, confirm still gates", async () => {
    await savedToken();
    const h = providerHarness();
    const { prompter, notes, outros } = fakePrompter([
      modeStep("cloud"),
      providerStep,
      domainStep(APEX),
      inUseStep(APEX),
      dnsStep("delegation", DELEGATION_FIRST),
      { kind: "confirm", expect: "Hetzner cpx31 — create the VM?", answer: false },
    ]);
    const { shell } = fakeShell();

    await upCommand(makeCtx(prompter, shell, fakeFetch({})), { size: "cpx31" }, {
      makeProvider: h.makeProvider,
      now: NOW,
      sleep: sleepNever,
      dnsPoll: FAST,
      sshPoll: FAST,
    });

    expect(h.calls).not.toContain("defaultSize");
    expect(notes.some((n) => n.message.includes("--size cpx31"))).toBe(true);
    expect(outros).toEqual(["Nothing was created."]);
  });

  it("NS poll timeout + cleanup accepted: destroys the discovered set, forgets the cache, rethrows", async () => {
    await seedKeys();
    await savedToken();
    const h = providerHarness();
    const { prompter, notes } = fakePrompter([
      modeStep("cloud"),
      providerStep,
      domainStep(APEX),
      inUseStep(APEX),
      dnsStep("delegation", DELEGATION_FIRST),
      priceConfirm(true),
      ...adminSteps(),
      acmeStep(),
      { kind: "confirm", expect: `Destroy the partially created resources for ${APEX}?`, answer: true, initialValue: true },
    ]);
    const { shell } = fakeShell();

    await expect(
      upCommand(makeCtx(prompter, shell, fakeFetch({})), {}, {
        makeProvider: h.makeProvider,
        now: NOW,
        sleep: sleepNever,
        dnsPoll: INSTANT_TIMEOUT,
        sshPoll: INSTANT_TIMEOUT,
      }),
    ).rejects.toMatchObject({ name: "CliError", hint: expect.stringContaining("try again") });

    // Honest about registrar lag before offering cleanup.
    expect(notes.some((n) => /hours/.test(n.message))).toBe(true);
    expect(h.calls).toContain("discoverStationResources");
    expect(h.destroyed).toEqual([h.resources]);
    const cfg = await loadConfig(paths);
    expect(cfg.stations).toHaveLength(0); // cache entry removed
    expect(cfg.tokens.hetzner).toBe("tok"); // token survives
  });

  it("NS poll timeout + cleanup declined: keeps the cache, destroys nothing, points at aerial down", async () => {
    await seedKeys();
    await savedToken();
    const h = providerHarness();
    const { prompter } = fakePrompter([
      modeStep("cloud"),
      providerStep,
      domainStep(APEX),
      inUseStep(APEX),
      dnsStep("delegation", DELEGATION_FIRST),
      priceConfirm(true),
      ...adminSteps(),
      acmeStep(),
      { kind: "confirm", expect: "Destroy the partially created resources", answer: false, initialValue: true },
    ]);
    const { shell } = fakeShell();

    await expect(
      upCommand(makeCtx(prompter, shell, fakeFetch({})), {}, {
        makeProvider: h.makeProvider,
        now: NOW,
        sleep: sleepNever,
        dnsPoll: INSTANT_TIMEOUT,
        sshPoll: INSTANT_TIMEOUT,
      }),
    ).rejects.toMatchObject({
      name: "CliError",
      hint: expect.stringContaining(`aerial down ${APEX}`),
    });

    expect(h.calls).not.toContain("discoverStationResources");
    expect(h.destroyed).toHaveLength(0);
    expect((await loadConfig(paths)).stations[0]).toMatchObject({ domain: APEX }); // cache stays
  });
});

// ---- review findings (adversarial pass) -----------------------------------

describe("upCommand — review findings", () => {
  it("a provisionStation failure gets the same cleanup offer as any later failure", async () => {
    await seedKeys();
    await savedToken();
    const h = providerHarness({
      onProvision: () => {
        throw new Error("server create timed out");
      },
    });
    const { prompter } = fakePrompter([
      modeStep("cloud"),
      providerStep,
      domainStep(APEX),
      inUseStep(APEX),
      dnsStep("delegation", DELEGATION_FIRST),
      priceConfirm(true),
      ...adminSteps(),
      acmeStep(),
      { kind: "confirm", expect: `Destroy the partially created resources for ${APEX}?`, answer: true, initialValue: true },
    ]);
    const { shell } = fakeShell();

    await expect(
      upCommand(makeCtx(prompter, shell, fakeFetch({})), {}, {
        makeProvider: h.makeProvider,
        now: NOW,
        sleep: sleepNever,
        dnsPoll: FAST,
        sshPoll: FAST,
      }),
    ).rejects.toMatchObject({ name: "CliError", hint: expect.stringContaining("try again") });

    // The half-created resource set is discovered and destroyed (plan: teardown
    // and up-failure share one code path), and nothing lingers in the cache.
    expect(h.calls).toContain("discoverStationResources");
    expect(h.destroyed).toEqual([h.resources]);
    expect((await loadConfig(paths)).stations).toHaveLength(0);
  });

  it("the A-record instruction points at the DNS host, never the registrar (they often differ)", async () => {
    await seedKeys();
    await savedToken();
    const dns: Record<string, string[]> = {};
    const h = providerHarness({ onProvision: () => (dns[`${SUB} A`] = [IPV4]) });
    // RDAP knows the registrar — the A-record note must still not send the
    // user there: the record lives at the DNS host, which is often elsewhere.
    const rdap = {
      entities: [
        {
          roles: ["registrar"],
          vcardArray: ["vcard", [["fn", {}, "text", "Namecheap"]]],
          links: [{ rel: "related", href: "https://www.namecheap.com" }],
        },
      ],
    };
    const { prompter, notes } = fakePrompter([
      modeStep("cloud"),
      providerStep,
      domainStep(SUB),
      inUseStep(SUB),
      dnsStep("a-record", ARECORD_FIRST),
      priceConfirm(true),
      ...adminSteps(),
      acmeStep(),
    ]);
    const { shell } = fakeShell();

    await upCommand(makeCtx(prompter, shell, fakeFetch(dns, rdap)), {}, {
      makeProvider: h.makeProvider,
      now: NOW,
      sleep: sleepNever,
      dnsPoll: FAST,
      sshPoll: FAST,
    });

    const recordNote = notes.find((n) => n.message.includes("add this record"));
    expect(recordNote?.message).toContain("your DNS host");
    expect(recordNote?.message).not.toContain("Namecheap");
  });
});
