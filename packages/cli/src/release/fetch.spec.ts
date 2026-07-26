import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError, type Shell } from "../context";
import { releaseTarballUrl } from "../version";
import { downloadReleaseTo } from "./fetch";

const TARBALL = new Uint8Array([0x1f, 0x8b, 0x08, 0x01, 0x02, 0x03]);

interface Call {
  cmd: string;
  args: string[];
}

function fakeFetch(response: Response) {
  const urls: string[] = [];
  const fn = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input));
    return response;
  }) as typeof globalThis.fetch;
  return { fn, urls };
}

/** Records argv; snapshots the tmp tarball while it still exists (tar time). */
function fakeShell(tarCode = 0) {
  const calls: Call[] = [];
  const seen = { tmpExisted: false, tmpBytes: null as Buffer | null };
  const shell: Shell = {
    async run(cmd, args) {
      calls.push({ cmd, args });
      const tmp = args[1] ?? "";
      seen.tmpExisted = existsSync(tmp);
      if (seen.tmpExisted) seen.tmpBytes = readFileSync(tmp);
      return { code: tarCode, stdout: "", stderr: tarCode ? "tar: boom" : "" };
    },
    async runStreaming() {
      throw new Error("unexpected runStreaming");
    },
  };
  return { shell, calls, seen };
}

describe("downloadReleaseTo", () => {
  let workDir: string;
  let destDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "aerial-fetch-spec-"));
    destDir = join(workDir, "station"); // does not exist yet — mkdir -p is on us
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("downloads the pinned tarball and extracts it into destDir", async () => {
    const { fn, urls } = fakeFetch(new Response(TARBALL, { status: 200 }));
    const { shell, calls, seen } = fakeShell();

    await downloadReleaseTo(fn, shell, destDir);

    expect(urls).toEqual([releaseTarballUrl()]);
    expect(calls).toHaveLength(1);
    const { cmd, args } = calls[0]!;
    expect(cmd).toBe("tar");
    expect(args[0]).toBe("-xzf");
    expect(args.slice(2)).toEqual(["-C", destDir, "--strip-components=1"]);
    const tmpFile = args[1]!;
    expect(tmpFile.startsWith(tmpdir())).toBe(true);
    expect(seen.tmpExisted).toBe(true);
    expect(new Uint8Array(seen.tmpBytes!)).toEqual(TARBALL);
    expect(existsSync(destDir)).toBe(true); // mkdir -p ran before tar
    expect(existsSync(tmpFile)).toBe(false); // tmp cleaned up
  });

  it("downloads an explicit ref when given", async () => {
    const { fn, urls } = fakeFetch(new Response(TARBALL, { status: 200 }));
    const { shell } = fakeShell();

    await downloadReleaseTo(fn, shell, destDir, "v9.9.9");

    expect(urls).toEqual([releaseTarballUrl("v9.9.9")]);
  });

  it("throws CliError on a non-2xx response, before touching the shell", async () => {
    const { fn } = fakeFetch(new Response("not found", { status: 404 }));
    const { shell, calls } = fakeShell();

    const err = await downloadReleaseTo(fn, shell, destDir).then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toContain("404");
    expect((err as CliError).hint).toMatch(/release|tag/i);
    expect(calls).toHaveLength(0);
  });

  it("throws CliError when tar exits non-zero, and still cleans up the tmp file", async () => {
    const { fn } = fakeFetch(new Response(TARBALL, { status: 200 }));
    const { shell, calls } = fakeShell(2);

    const err = await downloadReleaseTo(fn, shell, destDir).then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toMatch(/extract/i);
    expect(existsSync(calls[0]!.args[1]!)).toBe(false);
  });
  it("creates the destination dir private (0700) — the station dir will hold secrets", async () => {
    const { fn } = fakeFetch(new Response(TARBALL, { status: 200 }));
    const { shell } = fakeShell();

    await downloadReleaseTo(fn, shell, destDir);

    const { statSync } = await import("node:fs");
    expect(statSync(destDir).mode & 0o777).toBe(0o700);
  });
});
