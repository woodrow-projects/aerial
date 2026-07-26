import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { CliError, type Shell } from "../context";
import { privateKeyPath, publicKeyPath, type Paths } from "../paths";

/**
 * Reuse-or-create the per-user ed25519 keypair under configDir
 * (docs/plans/aerial-cli.md — install mechanics). Generated via system
 * ssh-keygen: no JS crypto lib to fight `bun --compile`.
 */
export async function ensureKeypair(
  shell: Shell,
  paths: Paths,
): Promise<{ privateKeyPath: string; publicKey: string }> {
  const priv = privateKeyPath(paths);
  const pub = publicKeyPath(paths);
  if (!existsSync(priv) || !existsSync(pub)) {
    mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
    const result = await shell.run("ssh-keygen", [
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      "aerial-cli",
      "-f",
      priv,
      "-q",
    ]);
    if (result.code !== 0) {
      throw new CliError(
        `ssh-keygen failed: ${result.stderr.trim() || `exit code ${result.code}`}`,
        "Install OpenSSH (preinstalled on macOS; on Debian/Ubuntu: apt install openssh-client).",
      );
    }
  }
  return { privateKeyPath: priv, publicKey: readFileSync(pub, "utf8").trim() };
}
