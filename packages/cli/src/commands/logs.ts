import { loadConfig } from "../config/store";
import type { Ctx } from "../context";
import { remoteComposeCmd } from "../install/remote";
import { sshStream } from "../ssh/transport";
import { resolveStation } from "./resolve";

export interface LogsCommandDeps {
  resolve?: typeof resolveStation;
}

/** `aerial logs <domain>` — follow the station's compose logs live. */
export async function logsCommand(ctx: Ctx, domain: string, deps: LogsCommandDeps = {}): Promise<void> {
  const resolve = deps.resolve ?? resolveStation;
  const cfg = await loadConfig(ctx.paths);
  const { conn } = await resolve({ fetch: ctx.fetch, paths: ctx.paths }, cfg, domain);
  // Non-zero exit just means the user stopped following (Ctrl-C = 130).
  await sshStream(ctx.shell, conn, remoteComposeCmd("logs -f --tail=200"));
}
