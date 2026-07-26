/**
 * cloud-init user-data: Docker install ONLY — the secret-free slow work that
 * overlaps the DNS walkthrough (docs/plans/aerial-cli.md).
 *
 * INVARIANT: no secrets in user-data, ever — providers serve user-data back to
 * any process on the box via the metadata endpoint (ADR D10). This function
 * takes zero parameters: a function that cannot receive a secret cannot leak
 * one. Everything secret or interactive goes over SSH instead.
 */
export function dockerInstallUserData(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "curl -fsSL https://get.docker.com | sh",
    "systemctl enable --now docker",
    "",
  ].join("\n");
}
