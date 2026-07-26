import { spawn } from "node:child_process";
import type { RunOpts, RunResult, Shell } from "./context";

/** Real Shell over node:child_process (seam contract in context.ts). */
export function nodeShell(): Shell {
  return {
    run(cmd: string, args: string[], opts: RunOpts = {}): Promise<RunResult> {
      return new Promise((resolve) => {
        const child = spawn(cmd, args, {
          cwd: opts.cwd,
          env: { ...process.env, ...opts.env },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => (stdout += chunk));
        child.stderr.on("data", (chunk: string) => (stderr += chunk));
        // Spawn failure (e.g. ENOENT): shell-style 127, never a rejection.
        child.on("error", (err) => resolve({ code: 127, stdout, stderr: stderr + err.message }));
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
        // Writing to a never-spawned child's stdin raises EPIPE — swallow it;
        // the 'error' handler above already settles the promise.
        child.stdin.on("error", () => {});
        if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
        // Always end stdin so children that read it see EOF instead of hanging.
        child.stdin.end();
      });
    },

    runStreaming(cmd: string, args: string[], opts: RunOpts = {}): Promise<number> {
      return new Promise((resolve) => {
        const withStdin = opts.stdin !== undefined;
        const child = spawn(cmd, args, {
          cwd: opts.cwd,
          env: { ...process.env, ...opts.env },
          stdio: withStdin ? ["pipe", "inherit", "inherit"] : "inherit",
        });
        child.on("error", () => resolve(127));
        child.on("close", (code) => resolve(code ?? 1));
        if (withStdin) {
          child.stdin!.on("error", () => {});
          child.stdin!.write(opts.stdin!);
          child.stdin!.end();
        }
      });
    },
  };
}
