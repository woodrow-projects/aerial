import type { RunResult, Shell } from "../context";
import { knownHostsPath, privateKeyPath, type Paths } from "../paths";

/**
 * System-ssh transport (docs/plans/aerial-cli.md — install mechanics): shell
 * out to `ssh`/`scp`, per-station known_hosts, TOFU `accept-new`. Remote
 * commands are always a single argv element — never interpolated into a
 * local shell string.
 */

export interface StationConn {
  domain: string;
  ipv4: string;
  paths: Paths;
}

/** -i/-o options minus BatchMode (interactive login must allow tty auth). */
function identityArgs(conn: StationConn): string[] {
  return [
    "-i",
    privateKeyPath(conn.paths),
    "-o",
    `UserKnownHostsFile=${knownHostsPath(conn.paths, conn.domain)}`,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
  ];
}

export function sshBaseArgs(conn: StationConn): string[] {
  return [...identityArgs(conn), "-o", "BatchMode=yes"];
}

export function sshTarget(conn: StationConn): string {
  return `root@${conn.ipv4}`;
}

export async function sshCapture(
  shell: Shell,
  conn: StationConn,
  command: string,
  opts?: { stdin?: string },
): Promise<RunResult> {
  return shell.run("ssh", [...sshBaseArgs(conn), sshTarget(conn), command], opts);
}

export async function sshStream(
  shell: Shell,
  conn: StationConn,
  command: string,
  opts?: { stdin?: string },
): Promise<number> {
  return shell.runStreaming("ssh", [...sshBaseArgs(conn), sshTarget(conn), command], opts);
}

export async function sshInteractive(shell: Shell, conn: StationConn): Promise<number> {
  return shell.runStreaming("ssh", [...identityArgs(conn), "-t", sshTarget(conn)]);
}

export async function scpFrom(
  shell: Shell,
  conn: StationConn,
  remotePath: string,
  localPath: string,
): Promise<RunResult> {
  return shell.run("scp", [...sshBaseArgs(conn), `${sshTarget(conn)}:${remotePath}`, localPath]);
}

/** Poll `true` over ssh until it exits 0; false once the budget is spent. */
export async function waitForSsh(
  shell: Shell,
  conn: StationConn,
  opts: {
    timeoutMs: number;
    intervalMs: number;
    sleep?: (ms: number) => Promise<void>;
    onTick?: (attempt: number) => void;
  },
): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  // Virtual clock (attempts x interval) — deterministic under injected sleep.
  let attempt = 0;
  let elapsedMs = 0;
  for (;;) {
    attempt += 1;
    opts.onTick?.(attempt);
    if ((await sshCapture(shell, conn, "true")).code === 0) return true;
    elapsedMs += opts.intervalMs;
    if (elapsedMs >= opts.timeoutMs) return false;
    await sleep(opts.intervalMs);
  }
}
