import { loadConfig } from "../config/store";
import type { Ctx } from "../context";
import { runRemoteUpgrade } from "../install/remote";
import { PINNED_AERIAL_REF } from "../version";
import { resolveStation } from "./resolve";

export interface UpgradeCommandDeps {
  resolve?: typeof resolveStation;
}

/** `aerial upgrade <domain>` — move the station to this CLI's pinned release. */
export async function upgradeCommand(ctx: Ctx, domain: string, deps: UpgradeCommandDeps = {}): Promise<void> {
  const resolve = deps.resolve ?? resolveStation;
  const cfg = await loadConfig(ctx.paths);
  const { conn } = await resolve({ fetch: ctx.fetch, paths: ctx.paths }, cfg, domain);

  const proceed = await ctx.prompter.confirm({
    message: `Upgrade ${domain} to aerial ${PINNED_AERIAL_REF}? The stack rebuilds and restarts (a short stream interruption).`,
    initialValue: true,
  });
  if (!proceed) {
    ctx.prompter.note(`No changes made — ${domain} keeps running its current version.`);
    return;
  }

  await runRemoteUpgrade(ctx.shell, conn);
  ctx.prompter.outro(`${domain} is now running aerial ${PINNED_AERIAL_REF}.`);
}
