import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CliConfig } from "../config/schema";
import {
  loadConfig,
  removeCachedStation,
  saveConfig,
  setLocalStation,
} from "../config/store";
import { CliError, type Ctx } from "../context";
import { DB_VOLUME_PATH, remoteComposeCmd } from "../install/remote";
import { knownHostsPath } from "../paths";
import { scpFrom, sshCapture, type StationConn } from "../ssh/transport";
import { resolveStation, type ResolveDeps } from "./resolve";

export interface DownDeps {
  resolve?: typeof resolveStation;
  makeProvider?: ResolveDeps["makeProvider"];
  now?: () => Date;
  /** fs.rm recursive wrapper (removes the local station dir). */
  rmrf?: (dir: string) => Promise<void>;
}

const DATA_LOSS_WARNING =
  "Everything on this station goes with it: accounts, channels, stream keys,\n" +
  "and listener history — all gone. This cannot be undone.";

const ABORTED = "Aborted — nothing was touched.";

/** Aborted mid-teardown with the stack already stopped for the snapshot try. */
const abortedStoppedNote = (what: string) =>
  `Aborted — nothing was destroyed. Heads up: the station was stopped for the\n` +
  `snapshot attempt, so ${what} is down until you bring it back up or destroy it.`;

const dateStamp = (now: () => Date) => now().toISOString().slice(0, 10);

const composeArgs = ["compose", "-f", "deploy/docker-compose.yml", "--env-file", ".env"];

/**
 * `aerial down <domain>` / `aerial down local` — destroy a station.
 * Cloud teardown is discovery-driven (ADR D16): it deletes what the provider
 * reports, never what the cache remembers, so a half-failed `up` is cleaned
 * by the same path. Typed-domain confirmation, no --force (by design).
 */
export async function downCommand(ctx: Ctx, domain: string, deps: DownDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const cfg = await loadConfig(ctx.paths);

  if (domain === "local") {
    const rmrf = deps.rmrf ?? ((dir: string) => rm(dir, { recursive: true, force: true }));
    await downLocal(ctx, cfg, now, rmrf);
    return;
  }
  await downCloud(ctx, cfg, domain, deps, now);
}

// ---- cloud ----------------------------------------------------------------

async function downCloud(
  ctx: Ctx,
  cfg: CliConfig,
  domain: string,
  deps: DownDeps,
  now: () => Date,
): Promise<void> {
  const resolve = deps.resolve ?? resolveStation;
  const { conn, provider, cached } = await resolve({ fetch: ctx.fetch, paths: ctx.paths }, cfg, domain, {
    makeProvider: deps.makeProvider,
  });

  // Destroy by discovery, never from cache — also cleans half-failed ups.
  const resources = await provider.discoverStationResources(domain);
  if (resources.length === 0) {
    throw new CliError(`Nothing found for ${domain}`, "See what exists with `aerial ls`.");
  }

  ctx.prompter.note(
    `${resources.map((r) => `- ${r.label}`).join("\n")}\n\n${DATA_LOSS_WARNING}`,
    `This will permanently destroy ${domain}`,
  );

  const typed = await ctx.prompter.text({ message: `Type ${domain} to confirm` });
  if (typed !== domain) {
    ctx.prompter.note(ABORTED);
    return;
  }

  const wantSnapshot = await ctx.prompter.confirm({
    message: "Download a copy of the station database first?",
    initialValue: true,
  });
  if (wantSnapshot) {
    const dest = join(ctx.paths.backupsDir, `${domain}-${dateStamp(now)}.db`);
    if (await cloudSnapshot(ctx, conn, dest)) {
      ctx.prompter.note(`Database copy saved to ${dest}`);
    } else {
      ctx.prompter.note("The database copy could not be downloaded.", "Snapshot failed");
      const goOn = await ctx.prompter.confirm({
        message: "Continue WITHOUT a snapshot?",
        initialValue: false,
      });
      if (!goOn) {
        ctx.prompter.note(abortedStoppedNote(domain));
        return;
      }
    }
  }

  const sp = ctx.prompter.spinner();
  sp.start(`Destroying ${domain}…`);
  await provider.destroyResources(resources);
  sp.stop("All station resources destroyed.");

  noteDnsLooseEnd(ctx, domain, cached?.dnsMode);

  await saveConfig(ctx.paths, removeCachedStation(cfg, domain));
  await rm(knownHostsPath(ctx.paths, domain), { force: true });
  ctx.prompter.outro(`${domain} destroyed.`);
}

/** Stop all writers first — only then is a raw copy of the SQLite file safe. */
async function cloudSnapshot(ctx: Ctx, conn: StationConn, dest: string): Promise<boolean> {
  const stop = await sshCapture(ctx.shell, conn, remoteComposeCmd("down"));
  if (stop.code !== 0) return false;
  await mkdir(ctx.paths.backupsDir, { recursive: true });
  const copy = await scpFrom(ctx.shell, conn, DB_VOLUME_PATH, dest);
  return copy.code === 0;
}

function noteDnsLooseEnd(ctx: Ctx, domain: string, dnsMode?: "delegation" | "a-record"): void {
  const delegationLine =
    `${domain} now points at nothing. To reuse the domain, ` +
    `change its nameservers back at your registrar.`;
  const aRecordLine = `Remove the A record for ${domain} at your registrar — it points at a dead IP now.`;
  const title = "One loose end: DNS";
  if (dnsMode === "delegation") ctx.prompter.note(delegationLine, title);
  else if (dnsMode === "a-record") ctx.prompter.note(aRecordLine, title);
  else {
    ctx.prompter.note(
      `If you delegated DNS…: ${delegationLine}\nIf you added an A record…: ${aRecordLine}`,
      title,
    );
  }
}

// ---- local ----------------------------------------------------------------

async function downLocal(
  ctx: Ctx,
  cfg: CliConfig,
  now: () => Date,
  rmrf: (dir: string) => Promise<void>,
): Promise<void> {
  const local = cfg.localStation;
  if (!local) {
    throw new CliError("No local station on this machine", "Start one with `aerial up`.");
  }

  ctx.prompter.note(
    `- Station files at ${local.dir}\n- The station database (Docker volume aerial_data)\n\n${DATA_LOSS_WARNING}`,
    "This will permanently destroy the local station",
  );

  const typed = await ctx.prompter.text({ message: "Type local to confirm" });
  if (typed !== "local") {
    ctx.prompter.note(ABORTED);
    return;
  }

  const wantSnapshot = await ctx.prompter.confirm({
    message: "Download a copy of the station database first?",
    initialValue: true,
  });
  if (wantSnapshot) {
    const fileName = `local-${dateStamp(now)}.db`;
    if (await localSnapshot(ctx, local.dir, fileName)) {
      ctx.prompter.note(`Database copy saved to ${join(ctx.paths.backupsDir, fileName)}`);
    } else {
      ctx.prompter.note("The database copy could not be made.", "Snapshot failed");
      const goOn = await ctx.prompter.confirm({
        message: "Continue WITHOUT a snapshot?",
        initialValue: false,
      });
      if (!goOn) {
        ctx.prompter.note(abortedStoppedNote("the local station"));
        return;
      }
    }
  }

  const code = await ctx.shell.runStreaming("docker", [...composeArgs, "down", "-v"], {
    cwd: local.dir,
  });
  if (code !== 0) {
    throw new CliError(
      "Couldn't remove the station's containers and volume (see output above).",
      "Check that Docker is running, then run `aerial down local` again.",
    );
  }
  await rmrf(local.dir);
  await saveConfig(ctx.paths, setLocalStation(cfg, null));
  ctx.prompter.outro("Local station destroyed.");
}

/** Stop writers, then copy the DB out of the volume. */
async function localSnapshot(ctx: Ctx, stationDir: string, fileName: string): Promise<boolean> {
  const stop = await ctx.shell.run("docker", [...composeArgs, "down"], { cwd: stationDir });
  if (stop.code !== 0) return false;
  await mkdir(ctx.paths.backupsDir, { recursive: true });
  // The volume path lives inside Docker's VM on macOS — a bind-mounted helper
  // container is the only portable copy.
  const copy = await ctx.shell.run("docker", [
    "run",
    "--rm",
    "-v",
    "aerial_data:/src",
    "-v",
    `${ctx.paths.backupsDir}:/dest`,
    "alpine",
    "cp",
    "/src/aerial.db",
    `/dest/${fileName}`,
  ]);
  return copy.code === 0;
}
