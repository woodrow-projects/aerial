import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeShell } from "./shell";

// The Shell seam's own test — the one spec allowed to spawn real processes.
// Only trivial, hermetic commands: the running node binary + a missing one.
const node = process.execPath;
const shell = nodeShell();

describe("nodeShell run", () => {
  it("captures stdout and resolves code 0", async () => {
    const res = await shell.run(node, ["-e", "process.stdout.write('hi')"]);
    expect(res).toEqual({ code: 0, stdout: "hi", stderr: "" });
  });

  it("captures stderr and a non-zero exit without throwing", async () => {
    const res = await shell.run(node, [
      "-e",
      "process.stderr.write('bad'); process.exit(3)",
    ]);
    expect(res.code).toBe(3);
    expect(res.stderr).toBe("bad");
    expect(res.stdout).toBe("");
  });

  it("merges opts.env over the parent env", async () => {
    process.env.AERIAL_SPEC_PARENT = "from-parent";
    process.env.AERIAL_SPEC_CLOBBER = "old";
    try {
      const res = await shell.run(
        node,
        [
          "-e",
          "process.stdout.write([process.env.AERIAL_SPEC_PARENT, process.env.AERIAL_SPEC_CLOBBER, process.env.AERIAL_SPEC_EXTRA].join('|'))",
        ],
        { env: { AERIAL_SPEC_CLOBBER: "new", AERIAL_SPEC_EXTRA: "extra" } },
      );
      expect(res.stdout).toBe("from-parent|new|extra");
    } finally {
      delete process.env.AERIAL_SPEC_PARENT;
      delete process.env.AERIAL_SPEC_CLOBBER;
    }
  });

  it("writes and ends opts.stdin", async () => {
    const res = await shell.run(
      node,
      [
        "-e",
        "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d.toUpperCase()))",
      ],
      { stdin: "secret" },
    );
    expect(res).toEqual({ code: 0, stdout: "SECRET", stderr: "" });
  });

  const tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("runs in opts.cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aerial-shell-spec-"));
    tempDirs.push(dir);
    const res = await shell.run(node, ["-e", "process.stdout.write(process.cwd())"], {
      cwd: dir,
    });
    expect(res.code).toBe(0);
    expect(realpathSync(res.stdout)).toBe(realpathSync(dir));
  });

  it("resolves code 127 with the spawn error in stderr for a missing binary", async () => {
    const res = await shell.run("aerial-spec-no-such-binary-1f2e", ["--version"]);
    expect(res.code).toBe(127);
    expect(res.stderr).toContain("ENOENT");
    expect(res.stdout).toBe("");
  });
});

describe("nodeShell runStreaming", () => {
  it("resolves the child's exit code", async () => {
    await expect(shell.runStreaming(node, ["-e", "process.exit(7)"])).resolves.toBe(7);
  });

  it("maps a null exit code (signal kill) to 1", async () => {
    await expect(
      shell.runStreaming(node, ["-e", "process.kill(process.pid,'SIGKILL')"]),
    ).resolves.toBe(1);
  });

  it("writes and ends opts.stdin while streaming", async () => {
    const code = await shell.runStreaming(
      node,
      [
        "-e",
        "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.exit(d==='ping'?0:9))",
      ],
      { stdin: "ping" },
    );
    expect(code).toBe(0);
  });

  it("resolves 127 for a missing binary", async () => {
    await expect(
      shell.runStreaming("aerial-spec-no-such-binary-1f2e", []),
    ).resolves.toBe(127);
  });
});
