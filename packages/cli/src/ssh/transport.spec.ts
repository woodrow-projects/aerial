import { describe, expect, it } from "vitest";
import type { RunOpts, RunResult, Shell } from "../context";
import type { Paths } from "../paths";
import {
  scpFrom,
  sshBaseArgs,
  sshCapture,
  sshInteractive,
  sshStream,
  sshTarget,
  waitForSsh,
  type StationConn,
} from "./transport";

const paths: Paths = {
  configDir: "/fake/config/aerial",
  stationDir: "/fake/data/aerial/station",
  backupsDir: "/fake/aerial-backups",
};
const conn: StationConn = { domain: "radio.example.com", ipv4: "203.0.113.7", paths };

const BASE_ARGS = [
  "-i",
  "/fake/config/aerial/id_ed25519",
  "-o",
  "UserKnownHostsFile=/fake/config/aerial/known_hosts.radio.example.com",
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "ConnectTimeout=10",
  "-o",
  "BatchMode=yes",
];
const TARGET = "root@203.0.113.7";

interface ShellCall {
  method: "run" | "runStreaming";
  cmd: string;
  args: string[];
  opts?: RunOpts;
}

function fakeShell(
  onRun: (call: ShellCall) => RunResult = () => ({ code: 0, stdout: "", stderr: "" }),
): { shell: Shell; calls: ShellCall[] } {
  const calls: ShellCall[] = [];
  return {
    calls,
    shell: {
      async run(cmd, args, opts) {
        const call: ShellCall = { method: "run", cmd, args, opts };
        calls.push(call);
        return onRun(call);
      },
      async runStreaming(cmd, args, opts) {
        const call: ShellCall = { method: "runStreaming", cmd, args, opts };
        calls.push(call);
        return onRun(call).code;
      },
    },
  };
}

describe("sshBaseArgs", () => {
  it("builds the exact -i/-o argv for non-interactive use", () => {
    expect(sshBaseArgs(conn)).toEqual(BASE_ARGS);
  });
});

describe("sshTarget", () => {
  it("is root at the station ipv4", () => {
    expect(sshTarget(conn)).toBe("root@203.0.113.7");
  });
});

describe("sshCapture", () => {
  it("runs ssh with base args, target, and the command as one argv element", async () => {
    const { shell, calls } = fakeShell(() => ({ code: 0, stdout: "out", stderr: "" }));
    const remote = 'echo "hi there" && docker ps';

    const result = await sshCapture(shell, conn, remote);

    expect(result).toEqual({ code: 0, stdout: "out", stderr: "" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("run");
    expect(calls[0]!.cmd).toBe("ssh");
    // Never interpolated into a shell string: the command is a single element.
    expect(calls[0]!.args).toEqual([...BASE_ARGS, TARGET, remote]);
  });

  it("passes stdin through", async () => {
    const { shell, calls } = fakeShell();

    await sshCapture(shell, conn, "cat > /root/answers.env", { stdin: "SECRET=1\n" });

    expect(calls[0]!.opts).toEqual({ stdin: "SECRET=1\n" });
  });
});

describe("sshStream", () => {
  it("uses runStreaming with the same argv and returns the exit code", async () => {
    const { shell, calls } = fakeShell(() => ({ code: 7, stdout: "", stderr: "" }));

    const code = await sshStream(shell, conn, "bash /root/install.sh");

    expect(code).toBe(7);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("runStreaming");
    expect(calls[0]!.cmd).toBe("ssh");
    expect(calls[0]!.args).toEqual([...BASE_ARGS, TARGET, "bash /root/install.sh"]);
  });

  it("passes stdin through", async () => {
    const { shell, calls } = fakeShell();

    await sshStream(shell, conn, "bash -s", { stdin: "echo hello\n" });

    expect(calls[0]!.opts).toEqual({ stdin: "echo hello\n" });
  });
});

describe("sshInteractive", () => {
  it("streams with -t, no command, and without BatchMode", async () => {
    const { shell, calls } = fakeShell(() => ({ code: 0, stdout: "", stderr: "" }));

    const code = await sshInteractive(shell, conn);

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("runStreaming");
    expect(calls[0]!.cmd).toBe("ssh");
    expect(calls[0]!.args).toEqual([
      "-i",
      "/fake/config/aerial/id_ed25519",
      "-o",
      "UserKnownHostsFile=/fake/config/aerial/known_hosts.radio.example.com",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=10",
      "-t",
      TARGET,
    ]);
  });
});

describe("scpFrom", () => {
  it("copies remote to local with the same -i/-o options", async () => {
    const { shell, calls } = fakeShell(() => ({ code: 0, stdout: "", stderr: "" }));

    const result = await scpFrom(shell, conn, "/srv/data/aerial.db", "/tmp/backup.db");

    expect(result.code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("run");
    expect(calls[0]!.cmd).toBe("scp");
    expect(calls[0]!.args).toEqual([...BASE_ARGS, `${TARGET}:/srv/data/aerial.db`, "/tmp/backup.db"]);
  });
});

describe("waitForSsh", () => {
  it("retries `true` until code 0, sleeping between attempts", async () => {
    const codes = [255, 255, 0];
    const { shell, calls } = fakeShell(() => ({
      code: codes.shift()!,
      stdout: "",
      stderr: "",
    }));
    const slept: number[] = [];
    const ticks: number[] = [];

    const ok = await waitForSsh(shell, conn, {
      timeoutMs: 60_000,
      intervalMs: 2_000,
      sleep: async (ms) => {
        slept.push(ms);
      },
      onTick: (attempt) => ticks.push(attempt),
    });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.method).toBe("run");
      expect(call.cmd).toBe("ssh");
      expect(call.args).toEqual([...BASE_ARGS, TARGET, "true"]);
    }
    expect(slept).toEqual([2_000, 2_000]);
    expect(ticks).toEqual([1, 2, 3]);
  });

  it("returns false once the interval budget is exhausted", async () => {
    const { shell, calls } = fakeShell(() => ({ code: 255, stdout: "", stderr: "" }));
    const slept: number[] = [];

    const ok = await waitForSsh(shell, conn, {
      timeoutMs: 3_000,
      intervalMs: 1_000,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(ok).toBe(false);
    // 3 attempts consume the 3s budget; no sleep after the last attempt.
    expect(calls).toHaveLength(3);
    expect(slept).toEqual([1_000, 1_000]);
  });
});
