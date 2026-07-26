import { describe, expect, it } from "vitest";
import { CliError, type Prompter, type Shell } from "./context";
import { ensureLocalDocker } from "./docker";

interface Call {
  cmd: string;
  args: string[];
}

/** `docker --version` answers with `docker`; `docker compose version` with `compose`. */
function fakeShell(
  opts: {
    docker?: number;
    compose?: number;
    /** Codes after the convenience script ran (absent = script changes nothing). */
    afterInstall?: { docker: number; compose: number };
  } = {},
) {
  let codes = { docker: opts.docker ?? 1, compose: opts.compose ?? 1 };
  const runs: Call[] = [];
  const streams: Call[] = [];
  const shell: Shell = {
    async run(cmd, args) {
      runs.push({ cmd, args });
      const code = args[0] === "compose" ? codes.compose : codes.docker;
      return { code, stdout: "", stderr: "" };
    },
    async runStreaming(cmd, args) {
      streams.push({ cmd, args });
      if (opts.afterInstall) codes = opts.afterInstall;
      return 0;
    },
  };
  return { shell, runs, streams };
}

function fakePrompter(confirmAnswer = false) {
  const confirms: string[] = [];
  const prompter: Prompter = {
    intro() {},
    outro() {},
    note() {},
    async text() {
      throw new Error("unexpected text");
    },
    async select(): Promise<never> {
      throw new Error("unexpected select");
    },
    async confirm(opts) {
      confirms.push(opts.message);
      return confirmAnswer;
    },
    async password() {
      throw new Error("unexpected password");
    },
    spinner() {
      return { start() {}, message() {}, stop() {} };
    },
  };
  return { prompter, confirms };
}

const reject = async (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected rejection");
    },
    (e: unknown) => e as CliError,
  );

describe("ensureLocalDocker", () => {
  it("returns silently when docker and compose are both present", async () => {
    const { shell, runs, streams } = fakeShell({ docker: 0, compose: 0 });
    const { prompter, confirms } = fakePrompter();

    await ensureLocalDocker({ shell, prompter, platform: "linux" });

    expect(runs).toEqual([
      { cmd: "docker", args: ["--version"] },
      { cmd: "docker", args: ["compose", "version"] },
    ]);
    expect(confirms).toHaveLength(0);
    expect(streams).toHaveLength(0);
  });

  it("treats docker-without-compose as missing", async () => {
    const { shell } = fakeShell({ docker: 0, compose: 1 });
    const { prompter } = fakePrompter();

    const err = await reject(
      ensureLocalDocker({ shell, prompter, platform: "darwin" }),
    );
    expect(err).toBeInstanceOf(CliError);
  });

  it("darwin: explains and stops with Desktop/OrbStack links, never installs", async () => {
    const { shell, streams } = fakeShell();
    const { prompter, confirms } = fakePrompter();

    const err = await reject(
      ensureLocalDocker({ shell, prompter, platform: "darwin" }),
    );

    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toContain("Docker is required");
    expect(err.hint).toContain("https://docs.docker.com/desktop/");
    expect(err.hint).toContain("https://orbstack.dev");
    expect(confirms).toHaveLength(0);
    expect(streams).toHaveLength(0);
  });

  it("linux: asks consent naming the script and the root-level change", async () => {
    const { shell } = fakeShell({ afterInstall: { docker: 0, compose: 0 } });
    const { prompter, confirms } = fakePrompter(true);

    await ensureLocalDocker({ shell, prompter, platform: "linux" });

    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain("get.docker.com");
    expect(confirms[0]).toMatch(/root/i);
  });

  it("linux: declined consent -> CliError, script never runs", async () => {
    const { shell, streams } = fakeShell();
    const { prompter } = fakePrompter(false);

    const err = await reject(
      ensureLocalDocker({ shell, prompter, platform: "linux" }),
    );

    expect(err).toBeInstanceOf(CliError);
    expect(streams).toHaveLength(0);
  });

  it("linux: accepted -> runs the convenience script, then re-checks and returns", async () => {
    const { shell, runs, streams } = fakeShell({
      afterInstall: { docker: 0, compose: 0 },
    });
    const { prompter } = fakePrompter(true);

    await ensureLocalDocker({ shell, prompter, platform: "linux" });

    expect(streams).toEqual([
      { cmd: "sh", args: ["-c", "curl -fsSL https://get.docker.com | sh"] },
    ]);
    // Post-install re-check of both commands.
    expect(runs.slice(-2)).toEqual([
      { cmd: "docker", args: ["--version"] },
      { cmd: "docker", args: ["compose", "version"] },
    ]);
  });

  it("linux: still missing after the script -> CliError", async () => {
    const { shell, streams } = fakeShell(); // no afterInstall: script changes nothing
    const { prompter } = fakePrompter(true);

    const err = await reject(
      ensureLocalDocker({ shell, prompter, platform: "linux" }),
    );

    expect(err).toBeInstanceOf(CliError);
    expect(streams).toHaveLength(1);
  });

  it("other platforms -> CliError (unsupported), no prompt", async () => {
    const { shell, streams } = fakeShell();
    const { prompter, confirms } = fakePrompter();

    const err = await reject(
      ensureLocalDocker({ shell, prompter, platform: "win32" }),
    );

    expect(err).toBeInstanceOf(CliError);
    expect(confirms).toHaveLength(0);
    expect(streams).toHaveLength(0);
  });
});
