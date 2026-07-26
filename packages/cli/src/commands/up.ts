import { dockerInstallUserData } from "../cloudinit/userdata";
import type { CliConfig, DnsMode } from "../config/schema";
import {
  cacheStation,
  loadConfig,
  removeCachedStation,
  saveConfig,
  setLocalStation,
  upsertToken,
} from "../config/store";
import { CliError, type Ctx } from "../context";
import { looksLikeSubdomain, pollForA, pollForNs, probeDomainInUse } from "../dns/guard";
import { registrarHint } from "../dns/rdap";
import { ensureLocalDocker } from "../docker";
import type { InstallAnswers } from "../install/answers";
import { runLocalInstall } from "../install/local";
import { runRemoteInstall } from "../install/remote";
import { makeProvider as defaultMakeProvider } from "../providers/registry";
import type { CloudProvider, ProviderId } from "../providers/types";
import { downloadReleaseTo } from "../release/fetch";
import { ensureKeypair } from "../ssh/keys";
import { waitForSsh, type StationConn } from "../ssh/transport";
import { PINNED_AERIAL_REF } from "../version";

export interface PollTiming {
  timeoutMs: number;
  intervalMs: number;
}

export interface UpDeps {
  makeProvider?: typeof defaultMakeProvider;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** NS / A record propagation wait (default 30 min at 10 s). */
  dnsPoll?: PollTiming;
  /** sshd reachability wait after VM create (default 5 min at 5 s). */
  sshPoll?: PollTiming;
}

const DNS_POLL_DEFAULT: PollTiming = { timeoutMs: 30 * 60_000, intervalMs: 10_000 };
const SSH_POLL_DEFAULT: PollTiming = { timeoutMs: 5 * 60_000, intervalMs: 5_000 };

const TOKEN_ATTEMPTS = 3;

/** Lowercase hostname: [a-z0-9-] labels (no edge hyphens), at least one dot. */
export function validateDomain(value: string): string | undefined {
  if (!value) return "Enter a domain, like radio.example.com";
  if (/[A-Z]/.test(value)) return "Lowercase only, please — domains are case-insensitive anyway";
  if (/[\s/:\\]/.test(value)) return "Just the domain itself — no http://, slashes, or spaces";
  const labels = value.split(".");
  if (labels.length < 2) return "That doesn't look like a full domain (needs a dot, like example.com)";
  for (const label of labels) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return "Domains can only use letters, numbers, and hyphens (not at the start or end of a part)";
    }
  }
  return undefined;
}

const validateEmail = (value: string): string | undefined =>
  value.includes("@") ? undefined : "That doesn't look like an email address";

const validatePassword = (value: string): string | undefined =>
  value.length >= 8 ? undefined : "Use at least 8 characters";

/** `aerial up` — create a station locally or on a freshly provisioned cloud VM. */
export async function upCommand(
  ctx: Ctx,
  opts: { size?: string } = {},
  deps: UpDeps = {},
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  ctx.prompter.intro("aerial up — let's get a station running");

  const mode = await ctx.prompter.select<"cloud" | "local">({
    message: "Where should this station run?",
    options: [
      { value: "cloud", label: "On a cloud VM (recommended)" },
      { value: "local", label: "On this machine — try it out" },
    ],
  });

  if (mode === "local") {
    await upLocal(ctx, now);
    return;
  }
  await upCloud(ctx, opts, deps, now);
}

// ---- shared prompts -------------------------------------------------------

async function collectAdmin(
  ctx: Ctx,
): Promise<{ adminEmail: string; adminName: string; adminPassword: string }> {
  const adminEmail = await ctx.prompter.text({
    message: "Admin email (you'll sign in with this)",
    validate: validateEmail,
  });
  const adminName = await ctx.prompter.text({
    message: "Admin display name",
    initialValue: "Operator",
  });
  for (;;) {
    const first = await ctx.prompter.password({
      message: "Choose an admin password (at least 8 characters)",
      validate: validatePassword,
    });
    const second = await ctx.prompter.password({ message: "Type it again to confirm" });
    if (first === second) return { adminEmail, adminName, adminPassword: first };
    ctx.prompter.note("Those didn't match — let's try again.");
  }
}

// ---- local ----------------------------------------------------------------

async function upLocal(ctx: Ctx, now: () => Date): Promise<void> {
  await ensureLocalDocker(ctx);

  const cfg = await loadConfig(ctx.paths);
  if (cfg.localStation) {
    throw new CliError(
      "A local station already exists",
      "There can only be one per machine. Remove it first with `aerial down local`.",
    );
  }

  const admin = await collectAdmin(ctx);
  const answers: InstallAnswers = {
    siteAddress: ":80",
    acmeEmail: "",
    publicBaseUrl: "http://localhost",
    ...admin,
  };

  const sp = ctx.prompter.spinner();
  sp.start(`Downloading aerial ${PINNED_AERIAL_REF}…`);
  await downloadReleaseTo(ctx.fetch, ctx.shell, ctx.paths.stationDir);
  sp.stop("Downloaded.");

  ctx.prompter.note("Installing — streaming the installer output below.");
  await runLocalInstall(ctx.shell, ctx.paths.stationDir, answers);

  await saveConfig(
    ctx.paths,
    setLocalStation(cfg, { dir: ctx.paths.stationDir, createdAt: now().toISOString() }),
  );
  ctx.prompter.outro(
    "Your station is running at http://localhost — see it with `aerial ls`, remove it with `aerial down local`.",
  );
}

// ---- cloud ----------------------------------------------------------------

async function upCloud(
  ctx: Ctx,
  opts: { size?: string },
  deps: UpDeps,
  now: () => Date,
): Promise<void> {
  const make = deps.makeProvider ?? defaultMakeProvider;
  const dnsPoll = deps.dnsPoll ?? DNS_POLL_DEFAULT;
  const sshPoll = deps.sshPoll ?? SSH_POLL_DEFAULT;
  let cfg = await loadConfig(ctx.paths);

  const providerId = await ctx.prompter.select<ProviderId>({
    message: "Which cloud provider?",
    options: [
      { value: "hetzner", label: "Hetzner — cheapest bandwidth (recommended)" },
      { value: "digitalocean", label: "DigitalOcean — a solid alternative" },
    ],
  });

  const got = await obtainVerifiedProvider(ctx, cfg, providerId, make);
  const provider = got.provider;
  cfg = got.cfg;

  const domain = await ctx.prompter.text({
    message: "What domain should the station live at? (e.g. radio.example.com)",
    validate: validateDomain,
  });

  const dnsMode = await chooseDnsMode(ctx, domain);

  // Confirm size + live price BEFORE any resource exists.
  let sizeId: string;
  let createMessage: string;
  if (opts.size) {
    sizeId = opts.size;
    ctx.prompter.note(`Using --size ${opts.size} (live price shown only for the default size).`);
    createMessage = `${provider.displayName} ${opts.size} — create the VM?`;
  } else {
    const sp = ctx.prompter.spinner();
    sp.start("Looking up the current price…");
    const size = await provider.defaultSize();
    sp.stop("Got it.");
    sizeId = size.id;
    createMessage = `${provider.displayName} ${size.id}, ${size.priceMonthly} ${size.currency}/mo + egress, ${size.region} — create the VM?`;
  }
  const create = await ctx.prompter.confirm({ message: createMessage, initialValue: true });
  if (!create) {
    ctx.prompter.outro("Nothing was created.");
    return;
  }

  const admin = await collectAdmin(ctx);
  const acmeEmail = await ctx.prompter.text({
    message: "Email for the TLS certificate (expiry notices go here)",
    initialValue: admin.adminEmail,
    validate: validateEmail,
  });
  const answers: InstallAnswers = {
    siteAddress: domain,
    acmeEmail,
    publicBaseUrl: `https://${domain}`,
    ...admin,
  };

  const { publicKey } = await ensureKeypair(ctx.shell, ctx.paths);
  const sp = ctx.prompter.spinner();
  sp.start("Creating the VM…");
  let vm;
  try {
    vm = await provider.provisionStation({
      domain,
      publicKey,
      userData: dockerInstallUserData(),
      size: sizeId,
    });
  } catch (err) {
    // Provisioning itself can half-fail (key/firewall created, VM stuck):
    // the same cleanup offer covers it — discovery finds whatever exists.
    sp.stop("The VM couldn't be created.");
    const reason = err instanceof Error ? err.message : String(err);
    return offerCleanup(ctx, cfg, provider, domain, reason); // always throws
  }
  sp.stop(`VM created — ${vm.ipv4}.`);

  // Cache immediately: even after a Ctrl-C, `aerial down` finds this fast.
  cfg = cacheStation(cfg, {
    domain,
    provider: providerId,
    dnsMode,
    ipv4: vm.ipv4,
    createdAt: now().toISOString(),
  });
  await saveConfig(ctx.paths, cfg);

  const conn: StationConn = { domain, ipv4: vm.ipv4, paths: ctx.paths };
  try {
    // DNS wait runs while cloud-init installs Docker on the VM in parallel.
    if (dnsMode === "delegation") {
      await delegationWait(ctx, provider, domain, vm.ipv4, dnsPoll, deps.sleep);
    } else {
      await aRecordWait(ctx, domain, vm.ipv4, dnsPoll, deps.sleep);
    }

    const wait = ctx.prompter.spinner();
    wait.start("Waiting for the VM to accept connections…");
    const reachable = await waitForSsh(ctx.shell, conn, {
      ...sshPoll,
      sleep: deps.sleep,
      onTick: (attempt) => wait.message(`Waiting for the VM to accept connections… (check ${attempt})`),
    });
    wait.stop(reachable ? "The VM is reachable." : "The VM never became reachable.");
    if (!reachable) {
      throw new CliError(`Couldn't reach the new VM (${vm.ipv4}) over SSH.`);
    }

    ctx.prompter.note("Connected. Installing aerial — this streams live and takes a few minutes.");
    await runRemoteInstall(ctx.shell, conn, answers);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await offerCleanup(ctx, cfg, provider, domain, reason); // always throws
  }

  ctx.prompter.outro(
    `Your station is live: control panel at https://${domain}\n` +
      "Point your streaming app at the panel's stream settings.\n" +
      `See it with \`aerial ls\` — follow logs with \`aerial logs ${domain}\` — tear it down with \`aerial down ${domain}\`.`,
  );
}

/** Saved-token fast path, else help + paste/verify loop; saves on success. */
async function obtainVerifiedProvider(
  ctx: Ctx,
  cfg: CliConfig,
  providerId: ProviderId,
  make: typeof defaultMakeProvider,
): Promise<{ provider: CloudProvider; cfg: CliConfig }> {
  const saved = cfg.tokens[providerId];
  // Built just for displayName/tokenHelp when no saved token exists.
  const first = make(providerId, { token: saved ?? "", fetch: ctx.fetch });

  if (saved) {
    const sp = ctx.prompter.spinner();
    sp.start(`Checking your saved ${first.displayName} token…`);
    const ok = await first.verifyToken();
    sp.stop(ok ? "Token works." : "The saved token no longer works.");
    if (ok) return { provider: first, cfg };
    ctx.prompter.note(`Your saved ${first.displayName} token didn't work — let's get a fresh one.`);
  }

  ctx.prompter.note(first.tokenHelp, `Getting a ${first.displayName} API token`);
  for (let attempt = 1; attempt <= TOKEN_ATTEMPTS; attempt++) {
    const token = await ctx.prompter.password({
      message: `Paste your ${first.displayName} API token`,
    });
    const provider = make(providerId, { token, fetch: ctx.fetch });
    const sp = ctx.prompter.spinner();
    sp.start("Checking the token…");
    const ok = await provider.verifyToken();
    sp.stop(ok ? "Token works." : "That token didn't work.");
    if (ok) {
      const next = upsertToken(cfg, providerId, token);
      await saveConfig(ctx.paths, next);
      return { provider, cfg: next };
    }
    if (attempt < TOKEN_ATTEMPTS) {
      ctx.prompter.note("That token didn't work — double-check it and paste it again.");
    }
  }
  throw new CliError(
    `None of the ${TOKEN_ATTEMPTS} tokens worked with ${first.displayName}.`,
    "Create a fresh API token in the provider console, then run `aerial up` again.",
  );
}

/**
 * Delegation-first with the in-use guard (plan, DNS section). The probe's
 * CliError propagates: an unanswerable probe must never green-light delegation.
 */
async function chooseDnsMode(ctx: Ctx, domain: string): Promise<DnsMode> {
  const sp = ctx.prompter.spinner();
  sp.start(`Checking whether ${domain} is already in use…`);
  let probe: { inUse: boolean; hits: string[] };
  try {
    probe = await probeDomainInUse(ctx.fetch, domain);
  } catch (err) {
    sp.stop("Couldn't check the domain.");
    throw err;
  }
  sp.stop(probe.inUse ? `${domain} has existing DNS records.` : `${domain} looks unused.`);

  const saidInUse = await ctx.prompter.confirm({
    message: `Is ${domain} used for anything else today — email, a website?`,
    initialValue: false,
  });

  const recommendDelegation = !probe.inUse && !saidInUse && !looksLikeSubdomain(domain);
  const delegation = {
    value: "delegation" as const,
    label: "aerial manages DNS — change nameservers once",
  };
  const aRecord = {
    value: "a-record" as const,
    label: "keep DNS where it is — add one A record",
  };
  const [recommended, other] = recommendDelegation ? [delegation, aRecord] : [aRecord, delegation];
  const choice = await ctx.prompter.select<DnsMode>({
    message: `How should DNS for ${domain} be set up?`,
    options: [{ ...recommended, label: `${recommended.label} (recommended)` }, other],
  });

  if (choice !== "delegation" || recommendDelegation) return choice;

  // Delegation against the guard's advice: spell out the blast radius.
  const hitsBlock = probe.hits.length
    ? `${domain} already has DNS records:\n${probe.hits.map((h) => `  ${h}`).join("\n")}\n\n`
    : "";
  ctx.prompter.note(
    `${hitsBlock}If aerial takes over DNS, every existing record for this domain is left behind — ` +
      "anything they power (email, a website) would stop working.",
    "Careful — this domain looks in use",
  );
  const anyway = await ctx.prompter.confirm({
    message: `Delegate ${domain} anyway?`,
    initialValue: false,
  });
  return anyway ? "delegation" : "a-record";
}

async function delegationWait(
  ctx: Ctx,
  provider: CloudProvider,
  domain: string,
  ipv4: string,
  poll: PollTiming,
  sleep?: (ms: number) => Promise<void>,
): Promise<void> {
  const sp = ctx.prompter.spinner();
  sp.start(`Setting up DNS for ${domain}…`);
  const zone = await provider.createZone(domain);
  await provider.createApexRecord(domain, ipv4);
  sp.stop("DNS zone created.");

  const hint = await registrarHint(ctx.fetch, domain);
  const registrar = hint?.name
    ? `your registrar (${hint.name}${hint.url ? ` — ${hint.url}` : ""})`
    : "your registrar";
  ctx.prompter.note(
    `At ${registrar}, replace the nameservers for ${domain} with these:\n\n` +
      `${zone.nameservers.map((ns) => `  ${ns}`).join("\n")}\n\n` +
      "This can take a while — I'll wait.",
    "One thing to do at your registrar",
  );

  const wait = ctx.prompter.spinner();
  wait.start("Waiting for the nameserver change…");
  const ok = await pollForNs(ctx.fetch, domain, zone.nameservers, {
    ...poll,
    sleep,
    onTick: (attempt) => wait.message(`Waiting for the nameserver change… (check ${attempt})`),
  });
  wait.stop(ok ? "Nameservers updated." : "The nameserver change hasn't shown up.");
  if (!ok) {
    throw new CliError(
      `The nameserver change for ${domain} hasn't shown up yet — nameserver changes can take ` +
        "a few hours at some registrars, so it may just need more time.",
    );
  }
}

async function aRecordWait(
  ctx: Ctx,
  domain: string,
  ipv4: string,
  poll: PollTiming,
  sleep?: (ms: number) => Promise<void>,
): Promise<void> {
  // No registrar hint here on purpose: the record is added at the DNS host,
  // which is often not the registrar (that hint belongs to delegation only).
  ctx.prompter.note(
    `At your DNS host (wherever ${domain}'s DNS is managed), add this record:\n\n` +
      `  ${domain}  A  ${ipv4}\n\n` +
      "This can take a while — I'll wait.",
    "One thing to do at your DNS host",
  );

  const wait = ctx.prompter.spinner();
  wait.start("Waiting for the record to show up…");
  const ok = await pollForA(ctx.fetch, domain, ipv4, {
    ...poll,
    sleep,
    onTick: (attempt) => wait.message(`Waiting for the record to show up… (check ${attempt})`),
  });
  wait.stop(ok ? "The record resolves." : "The record hasn't shown up.");
  if (!ok) {
    throw new CliError(
      `${domain} still doesn't point at ${ipv4} — DNS changes can take a few hours at some ` +
        "hosts, so it may just need more time.",
    );
  }
}

/** Post-provision failure: offer teardown of the partial station. Always throws. */
async function offerCleanup(
  ctx: Ctx,
  cfg: CliConfig,
  provider: CloudProvider,
  domain: string,
  reason: string,
): Promise<never> {
  ctx.prompter.note(reason, "Something went wrong");
  const destroy = await ctx.prompter.confirm({
    message: `Destroy the partially created resources for ${domain}?`,
    initialValue: true,
  });
  if (!destroy) {
    throw new CliError(
      `Setting up ${domain} didn't finish: ${reason}`,
      `Its cloud resources are still there — \`aerial down ${domain}\` cleans this up whenever you're ready.`,
    );
  }
  const sp = ctx.prompter.spinner();
  sp.start("Cleaning up…");
  const resources = await provider.discoverStationResources(domain);
  await provider.destroyResources(resources);
  sp.stop("Cleaned up — nothing was left running.");
  await saveConfig(ctx.paths, removeCachedStation(cfg, domain));
  throw new CliError(
    `Setting up ${domain} didn't finish: ${reason}`,
    "Everything created for it was destroyed — run `aerial up` to try again.",
  );
}
