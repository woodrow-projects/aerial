/**
 * Version pinning (docs/plans/aerial-cli.md — install mechanics).
 *
 * Each CLI version maps to a pinned aerial release ref — never `main` — so a
 * given CLI binary only ever installs a combination that was tested together.
 * The release workflow asserts the pinned tag exists before publishing.
 */
export const CLI_VERSION = "0.1.0";

export const AERIAL_REPO = "woodrow-projects/aerial";

/**
 * The aerial repo ref this CLI version installs. Lockstep by construction:
 * one `vX.Y.Z` tag versions the whole repo (server tarball + CLI binaries),
 * so the pin is derived, never maintained.
 */
export const PINNED_AERIAL_REF = `v${CLI_VERSION}`;

/** Tarball of the pinned release (no auth, no git required on the target). */
export function releaseTarballUrl(ref: string = PINNED_AERIAL_REF): string {
  return `https://codeload.github.com/${AERIAL_REPO}/tar.gz/${ref}`;
}
