import { describe, expect, it } from "vitest";
import type { RunOpts, RunResult, Shell } from "../context";
import { CliError } from "../context";
import type { InstallAnswers } from "./answers";
import { runLocalInstall } from "./local";

const answers: InstallAnswers = {
  siteAddress: ":80",
  acmeEmail: "",
  publicBaseUrl: "http://localhost",
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
      throw new Error("run() must not be used for the local install");
    },
    runStreaming(cmd, args, opts) {
      calls.push({ cmd, args, opts });
      return Promise.resolve(exitCode);
    },
  };
  return { shell, calls };
}

describe("runLocalInstall", () => {
  it("streams bash deploy/install.sh in the station dir with installEnv vars", async () => {
    const { shell, calls } = fakeShell(0);
    await runLocalInstall(shell, "/tmp/station", answers);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.cmd).toBe("bash");
    expect(call.args).toEqual(["deploy/install.sh"]);
    expect(call.opts?.cwd).toBe("/tmp/station");
    expect(call.opts?.env).toEqual({
      SITE_ADDRESS: ":80",
      ACME_EMAIL: "",
      PUBLIC_BASE_URL: "http://localhost",
      ADMIN_EMAIL: "op@example.com",
      ADMIN_NAME: "Operator",
      ADMIN_PASSWORD: "pa'ss\"wd$(",
    });
  });

  it("keeps secrets out of argv (env only)", async () => {
    const { shell, calls } = fakeShell(0);
    await runLocalInstall(shell, "/tmp/station", answers);
    const argv = [calls[0]!.cmd, ...calls[0]!.args].join(" ");
    expect(argv).not.toContain(answers.adminPassword);
    expect(argv).not.toContain(answers.adminEmail);
  });

  it("throws CliError with a compose-logs hint on non-zero exit", async () => {
    const { shell } = fakeShell(1);
    const p = runLocalInstall(shell, "/tmp/station", answers);
    await expect(p).rejects.toBeInstanceOf(CliError);
    await expect(p).rejects.toMatchObject({
      hint: expect.stringContaining("docker compose"),
    });
  });
});
