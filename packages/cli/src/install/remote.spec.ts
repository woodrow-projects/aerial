import { describe, expect, it } from "vitest";
import type { RunOpts, RunResult, Shell } from "../context";
import { CliError } from "../context";
import type { Paths } from "../paths";
import type { StationConn } from "../ssh/transport";
import { releaseTarballUrl } from "../version";
import type { InstallAnswers } from "./answers";
import { installEnv } from "./answers";
import {
  DB_VOLUME_PATH,
  REMOTE_DIR,
  remoteComposeCmd,
  remoteInstallScript,
  remoteUpgradeScript,
  runRemoteInstall,
  runRemoteUpgrade,
  shellQuote,
} from "./remote";

const paths: Paths = {
  configDir: "/fake/config/aerial",
  stationDir: "/fake/data/aerial/station",
  backupsDir: "/fake/aerial-backups",
};
const conn: StationConn = { domain: "radio.example.com", ipv4: "203.0.113.7", paths };

const answers: InstallAnswers = {
  siteAddress: "radio.example.com",
  acmeEmail: "certs@example.com",
  publicBaseUrl: "https://radio.example.com",
  adminEmail: "op@example.com",
  adminName: "Operator",
  adminPassword: "pa'ss\"wd$(",
};

interface StreamCall {
  cmd: string;
  args: string[];
  opts?: RunOpts;
}

function fakeShell(exitCode: number): { shell: Shell; calls: StreamCall[] } {
  const calls: StreamCall[] = [];
  const shell: Shell = {
    run(): Promise<RunResult> {
      throw new Error("run() must not be used for streaming remote scripts");
    },
    runStreaming(cmd, args, opts) {
      calls.push({ cmd, args, opts });
      return Promise.resolve(exitCode);
    },
  };
  return { shell, calls };
}

/** Evaluate a POSIX-quoted word the way a shell would (quotes + backslash). */
function posixUnquote(quoted: string): string {
  let out = "";
  let i = 0;
  let inQuotes = false;
  while (i < quoted.length) {
    const c = quoted[i]!;
    if (inQuotes) {
      if (c === "'") inQuotes = false;
      else out += c;
      i += 1;
    } else if (c === "'") {
      inQuotes = true;
      i += 1;
    } else if (c === "\\") {
      out += quoted[i + 1] ?? "";
      i += 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

describe("constants", () => {
  it("pin the remote install dir and the db file inside the compose volume", () => {
    expect(REMOTE_DIR).toBe("/opt/aerial");
    expect(DB_VOLUME_PATH).toBe("/var/lib/docker/volumes/aerial_data/_data/aerial.db");
  });
});

describe("remoteComposeCmd", () => {
  it("cds into the station dir and runs compose with the pinned file + env-file", () => {
    expect(remoteComposeCmd("logs -f")).toBe(
      "cd /opt/aerial && docker compose -f deploy/docker-compose.yml --env-file .env logs -f",
    );
  });
});

describe("shellQuote", () => {
  it("single-quotes a plain value", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes as '\\''", () => {
    expect(shellQuote("pa'ss\"wd$(")).toBe("'pa'\\''ss\"wd$('");
  });

  it("round-trips adversarial values through POSIX evaluation", () => {
    const nasty = [
      "pa'ss\"wd$(",
      "$(reboot)",
      "`id`",
      "$HOME;rm -rf /",
      "a\nb",
      "'''",
      "\\backslash\\",
    ];
    for (const v of nasty) {
      expect(posixUnquote(shellQuote(v))).toBe(v);
    }
  });
});

describe("remoteInstallScript", () => {
  const script = remoteInstallScript(answers);

  it("is strict-mode bash", () => {
    expect(script.startsWith("set -euo pipefail\n")).toBe(true);
  });

  it("exports every installEnv var, shellQuoted", () => {
    for (const [key, value] of Object.entries(installEnv(answers))) {
      expect(script).toContain(`export ${key}=${shellQuote(value)}`);
    }
    // The adversarial password appears only in its quoted form.
    expect(script).toContain("export ADMIN_PASSWORD='pa'\\''ss\"wd$('");
    expect(script).not.toContain("export ADMIN_PASSWORD=pa");
  });

  it("waits for cloud-init's docker install with a bounded loop that fails loudly", () => {
    expect(script).toContain("until command -v docker");
    // Bounded: 60 tries x 3s = 180s, then exit 1.
    expect(script).toMatch(/-ge 60/);
    expect(script).toContain("sleep 3");
    expect(script).toContain("exit 1");
  });

  it("extracts the pinned release tarball into REMOTE_DIR and runs install.sh there", () => {
    expect(script).toContain("mkdir -p /opt/aerial");
    expect(script).toContain(
      `curl -fsSL ${releaseTarballUrl()} | tar -xz -C /opt/aerial --strip-components=1`,
    );
    expect(script.indexOf("cd /opt/aerial\n")).toBeLessThan(
      script.indexOf("bash deploy/install.sh"),
    );
  });

  it("uses the given ref's tarball when overridden", () => {
    expect(remoteInstallScript(answers, "v9.9.9")).toContain(releaseTarballUrl("v9.9.9"));
  });
});

describe("remoteUpgradeScript", () => {
  const script = remoteUpgradeScript();

  it("is strict-mode bash and refuses to run without an existing install", () => {
    expect(script.startsWith("set -euo pipefail\n")).toBe(true);
    expect(script).toContain("[ -f /opt/aerial/.env ] ||");
  });

  it("stages the new release fresh, adopts .env, swaps dirs, installs, then cleans up", () => {
    const tarNew = script.indexOf("tar -xz -C /opt/aerial.new --strip-components=1");
    const cpEnv = script.indexOf("cp /opt/aerial/.env /opt/aerial.new/");
    const clearOld = script.indexOf("rm -rf /opt/aerial.old");
    const mvOld = script.indexOf("mv /opt/aerial /opt/aerial.old");
    const mvNew = script.indexOf("mv /opt/aerial.new /opt/aerial");
    const install = script.indexOf("bash deploy/install.sh");
    const cleanup = script.lastIndexOf("rm -rf /opt/aerial.old");

    // .new is recreated from scratch before the tarball lands in it.
    expect(script.indexOf("rm -rf /opt/aerial.new")).toBeLessThan(tarNew);
    expect(script).toContain(`curl -fsSL ${releaseTarballUrl()} | tar -xz -C /opt/aerial.new`);

    // .env is preserved BEFORE the live dir moves away.
    expect(cpEnv).toBeGreaterThan(tarNew);
    expect(cpEnv).toBeLessThan(mvOld);
    // Swap order: clear stale .old -> live becomes .old -> .new becomes live.
    expect(clearOld).toBeLessThan(mvOld);
    expect(mvOld).toBeLessThan(mvNew);
    expect(mvNew).toBeLessThan(install);
    // .old removed only after install.sh succeeded (set -e guards this).
    expect(cleanup).toBeGreaterThan(install);
  });

  it("uses the given ref's tarball when overridden", () => {
    expect(remoteUpgradeScript("v9.9.9")).toContain(releaseTarballUrl("v9.9.9"));
  });
});

describe("runRemoteInstall", () => {
  it("streams the script to `bash -s` over ssh; secrets ride stdin, never argv", async () => {
    const { shell, calls } = fakeShell(0);
    await runRemoteInstall(shell, conn, answers);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.cmd).toBe("ssh");
    expect(call.args[call.args.length - 1]).toBe("bash -s");
    expect(call.args).toContain("root@203.0.113.7");
    expect(call.opts?.stdin).toBe(remoteInstallScript(answers));

    const argv = [call.cmd, ...call.args].join(" ");
    expect(argv).not.toContain(answers.adminPassword);
    expect(argv).not.toContain(answers.adminEmail);
    expect(argv).not.toContain(answers.adminName);
  });

  it("passes the ref through to the script", async () => {
    const { shell, calls } = fakeShell(0);
    await runRemoteInstall(shell, conn, answers, "v9.9.9");
    expect(calls[0]!.opts?.stdin).toBe(remoteInstallScript(answers, "v9.9.9"));
  });

  it("throws CliError with a logs hint on non-zero exit", async () => {
    const { shell } = fakeShell(1);
    const p = runRemoteInstall(shell, conn, answers);
    await expect(p).rejects.toBeInstanceOf(CliError);
    await expect(p).rejects.toMatchObject({
      hint: expect.stringContaining("docker compose"),
    });
  });
});

describe("runRemoteUpgrade", () => {
  it("streams the upgrade script to `bash -s` over ssh", async () => {
    const { shell, calls } = fakeShell(0);
    await runRemoteUpgrade(shell, conn, "v9.9.9");

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.cmd).toBe("ssh");
    expect(call.args[call.args.length - 1]).toBe("bash -s");
    expect(call.opts?.stdin).toBe(remoteUpgradeScript("v9.9.9"));
  });

  it("throws CliError on non-zero exit", async () => {
    const { shell } = fakeShell(7);
    await expect(runRemoteUpgrade(shell, conn)).rejects.toBeInstanceOf(CliError);
  });
});
