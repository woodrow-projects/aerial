import type { Shell } from "../context";
import { CliError } from "../context";
import { sshStream, type StationConn } from "../ssh/transport";
import { releaseTarballUrl } from "../version";
import type { InstallAnswers } from "./answers";
import { installEnv } from "./answers";

/**
 * Everything the CLI executes on a station VM over ssh. Scripts are streamed
 * to `bash -s` via stdin — answers (passwords!) must NEVER ride the ssh argv,
 * where they'd be visible in `ps` and shell history on both ends (plan
 * invariant; ADR D10).
 */

export const REMOTE_DIR = "/opt/aerial";

/** compose project `aerial`, volume `data` (deploy/docker-compose.yml). */
export const DB_VOLUME_PATH = "/var/lib/docker/volumes/aerial_data/_data/aerial.db";

/** A compose invocation as one remote shell line (for `logs`, `down`, …). */
export function remoteComposeCmd(sub: string): string {
  return `cd ${REMOTE_DIR} && docker compose -f deploy/docker-compose.yml --env-file .env ${sub}`;
}

/** POSIX single-quote escaping (' -> '\''): the value expands to itself, always. */
export function shellQuote(v: string): string {
  return `'${v.replaceAll("'", `'\\''`)}'`;
}

/**
 * Fresh install on a VM: export the answers, wait out cloud-init's Docker
 * install (ssh comes up before cloud-init finishes; bounded at 60 x 3s =
 * 180s), unpack the pinned release, run the engine.
 */
export function remoteInstallScript(answers: InstallAnswers, ref?: string): string {
  const exports = Object.entries(installEnv(answers))
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n");
  return `set -euo pipefail
${exports}
if ! command -v docker >/dev/null 2>&1; then
  echo 'Waiting for cloud-init to finish installing Docker (up to 180s)...'
  tries=0
  until command -v docker >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ]; then
      echo 'Docker never appeared — cloud-init likely failed. See /var/log/cloud-init-output.log on the VM.' >&2
      exit 1
    fi
    sleep 3
  done
fi
mkdir -p ${REMOTE_DIR}
curl -fsSL ${releaseTarballUrl(ref)} | tar -xz -C ${REMOTE_DIR} --strip-components=1
cd ${REMOTE_DIR}
bash deploy/install.sh
`;
}

/**
 * Upgrade in place: stage the new release beside the old, adopt the existing
 * .env (install.sh then takes its non-fresh path: rebuild + additive
 * migrations, secrets untouched), swap dirs, re-run the engine. `set -e`
 * keeps .old around if anything fails before the final cleanup.
 */
export function remoteUpgradeScript(ref?: string): string {
  return `set -euo pipefail
[ -f ${REMOTE_DIR}/.env ] || { echo 'No station at ${REMOTE_DIR} (missing .env) — nothing to upgrade.' >&2; exit 1; }
rm -rf ${REMOTE_DIR}.new
mkdir -p ${REMOTE_DIR}.new
curl -fsSL ${releaseTarballUrl(ref)} | tar -xz -C ${REMOTE_DIR}.new --strip-components=1
cp ${REMOTE_DIR}/.env ${REMOTE_DIR}.new/
rm -rf ${REMOTE_DIR}.old
mv ${REMOTE_DIR} ${REMOTE_DIR}.old
mv ${REMOTE_DIR}.new ${REMOTE_DIR}
cd ${REMOTE_DIR}
bash deploy/install.sh
rm -rf ${REMOTE_DIR}.old
`;
}

export async function runRemoteInstall(
  shell: Shell,
  conn: StationConn,
  answers: InstallAnswers,
  ref?: string,
): Promise<void> {
  const code = await sshStream(shell, conn, "bash -s", {
    stdin: remoteInstallScript(answers, ref),
  });
  if (code !== 0) {
    throw new CliError(
      "Remote install failed (see output above).",
      `Inspect the VM: aerial ssh ${conn.domain}, then \`${remoteComposeCmd("logs")}\``,
    );
  }
}

export async function runRemoteUpgrade(
  shell: Shell,
  conn: StationConn,
  ref?: string,
): Promise<void> {
  const code = await sshStream(shell, conn, "bash -s", { stdin: remoteUpgradeScript(ref) });
  if (code !== 0) {
    throw new CliError(
      "Remote upgrade failed (see output above).",
      `The previous release stays at ${REMOTE_DIR}.old on the VM until an upgrade succeeds. ` +
        `Inspect: aerial ssh ${conn.domain}, then \`${remoteComposeCmd("logs")}\``,
    );
  }
}
