import { randomBytes } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError, type Shell } from "../context";
import { AERIAL_REPO, PINNED_AERIAL_REF, releaseTarballUrl } from "../version";

/**
 * Download the pinned aerial release tarball and extract it into `destDir`
 * (top-level directory stripped, so destDir IS the repo root). Shared by
 * local mode (direct) and cloud mode (the same tarball, curled over SSH).
 */
export async function downloadReleaseTo(
  fetchFn: typeof globalThis.fetch,
  shell: Shell,
  destDir: string,
  ref: string = PINNED_AERIAL_REF,
): Promise<void> {
  const url = releaseTarballUrl(ref);
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new CliError(
      `Downloading the aerial release failed (HTTP ${res.status}): ${url}`,
      `The release tag "${ref}" may not exist on ${AERIAL_REPO} — check the repo's releases.`,
    );
  }

  const tmpFile = join(
    tmpdir(),
    `aerial-release-${randomBytes(8).toString("hex")}.tar.gz`,
  );
  try {
    await writeFile(tmpFile, Buffer.from(await res.arrayBuffer()));
    // Private: the extracted tree will hold the station's .env secrets (D10).
    // chmod as well — mkdir's mode is umask-masked and skipped if the dir exists.
    await mkdir(destDir, { recursive: true, mode: 0o700 });
    await chmod(destDir, 0o700);
    const tar = await shell.run("tar", [
      "-xzf",
      tmpFile,
      "-C",
      destDir,
      "--strip-components=1",
    ]);
    if (tar.code !== 0) {
      throw new CliError(
        `Extracting the release failed (tar exit ${tar.code}).`,
        tar.stderr.trim() || undefined,
      );
    }
  } finally {
    await rm(tmpFile, { force: true });
  }
}
