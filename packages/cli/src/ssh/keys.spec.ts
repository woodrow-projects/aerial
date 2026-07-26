import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliError, type RunOpts, type RunResult, type Shell } from "../context";
import { privateKeyPath, publicKeyPath, type Paths } from "../paths";
import { ensureKeypair } from "./keys";

interface ShellCall {
  cmd: string;
  args: string[];
  opts?: RunOpts;
}

function fakeShell(
  onRun: (cmd: string, args: string[], opts?: RunOpts) => RunResult,
): { shell: Shell; calls: ShellCall[] } {
  const calls: ShellCall[] = [];
  return {
    calls,
    shell: {
      async run(cmd, args, opts) {
        calls.push({ cmd, args, opts });
        return onRun(cmd, args, opts);
      },
      async runStreaming() {
        throw new Error("unexpected runStreaming");
      },
    },
  };
}

describe("ensureKeypair", () => {
  let tmp: string;
  let paths: Paths;

  const setup = () => {
    tmp = mkdtempSync(join(tmpdir(), "aerial-keys-"));
    paths = {
      configDir: join(tmp, "config", "aerial"),
      stationDir: join(tmp, "data", "aerial", "station"),
      backupsDir: join(tmp, "aerial-backups"),
    };
  };

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns the existing keypair without shelling out", async () => {
    setup();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(privateKeyPath(paths), "PRIVATE\n");
    writeFileSync(publicKeyPath(paths), "ssh-ed25519 AAAAtest aerial-cli\n");
    const { shell, calls } = fakeShell(() => ({ code: 0, stdout: "", stderr: "" }));

    const result = await ensureKeypair(shell, paths);

    expect(calls).toEqual([]);
    expect(result).toEqual({
      privateKeyPath: privateKeyPath(paths),
      publicKey: "ssh-ed25519 AAAAtest aerial-cli",
    });
  });

  it("generates a keypair via ssh-keygen when files are missing", async () => {
    setup();
    const { shell, calls } = fakeShell(() => {
      // Simulate ssh-keygen writing both key files.
      writeFileSync(privateKeyPath(paths), "PRIVATE\n");
      writeFileSync(publicKeyPath(paths), "ssh-ed25519 AAAAgen aerial-cli\n");
      return { code: 0, stdout: "", stderr: "" };
    });

    const result = await ensureKeypair(shell, paths);

    expect(calls).toEqual([
      {
        cmd: "ssh-keygen",
        args: [
          "-t",
          "ed25519",
          "-N",
          "",
          "-C",
          "aerial-cli",
          "-f",
          privateKeyPath(paths),
          "-q",
        ],
        opts: undefined,
      },
    ]);
    expect(statSync(paths.configDir).mode & 0o777).toBe(0o700);
    expect(result).toEqual({
      privateKeyPath: privateKeyPath(paths),
      publicKey: "ssh-ed25519 AAAAgen aerial-cli",
    });
  });

  it("takes the generate path when only one key file exists", async () => {
    setup();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(privateKeyPath(paths), "PRIVATE\n");
    expect(existsSync(publicKeyPath(paths))).toBe(false);
    const { shell, calls } = fakeShell(() => {
      writeFileSync(privateKeyPath(paths), "PRIVATE2\n");
      writeFileSync(publicKeyPath(paths), "ssh-ed25519 AAAAregen aerial-cli\n");
      return { code: 0, stdout: "", stderr: "" };
    });

    const result = await ensureKeypair(shell, paths);

    expect(calls).toHaveLength(1);
    expect(result.publicKey).toBe("ssh-ed25519 AAAAregen aerial-cli");
  });

  it("throws CliError with an OpenSSH hint when ssh-keygen fails", async () => {
    setup();
    const { shell } = fakeShell(() => ({
      code: 127,
      stdout: "",
      stderr: "ssh-keygen: command not found",
    }));

    const err = await ensureKeypair(shell, paths).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toContain("ssh-keygen");
    expect((err as CliError).hint).toMatch(/OpenSSH/i);
  });
});
