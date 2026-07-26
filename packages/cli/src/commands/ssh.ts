import { loadConfig } from "../config/store";
import type { Ctx } from "../context";
import { sshInteractive } from "../ssh/transport";
import { resolveStation } from "./resolve";

export interface SshCommandDeps {
  resolve?: typeof resolveStation;
}

/** `aerial ssh <domain>` — open an interactive root shell on the station VM. */
export async function sshCommand(ctx: Ctx, domain: string, deps: SshCommandDeps = {}): Promise<void> {
  const resolve = deps.resolve ?? resolveStation;
  const cfg = await loadConfig(ctx.paths);
  const { conn } = await resolve({ fetch: ctx.fetch, paths: ctx.paths }, cfg, domain);
  // Non-zero exit just means the user ended the session (exit / Ctrl-D).
  await sshInteractive(ctx.shell, conn);
}
