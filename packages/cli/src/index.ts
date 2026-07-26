/**
 * aerial — provision a self-hosted radio station anywhere.
 * Wiring only (arg routing + real-dependency construction); all logic lives
 * in commands/ and is unit-tested there. Only this file and prompts.ts may
 * call process.exit.
 */
import { downCommand } from "./commands/down";
import { logsCommand } from "./commands/logs";
import { lsCommand } from "./commands/ls";
import { sshCommand } from "./commands/ssh";
import { upCommand } from "./commands/up";
import { upgradeCommand } from "./commands/upgrade";
import { CliError, type Ctx } from "./context";
import { defaultPaths } from "./paths";
import { clackPrompter } from "./prompts";
import { nodeShell } from "./shell";
import { CLI_VERSION } from "./version";

export function usage(): string {
  return [
    `aerial ${CLI_VERSION} — self-hosted online radio, one command`,
    "",
    "Usage:",
    "  aerial up                 Create a station (local machine or cloud VM)",
    "  aerial ls                 List stations across providers + this machine",
    "  aerial down <domain>      Destroy a station (typed confirmation)",
    "  aerial ssh <domain>       Open a shell on the station VM",
    "  aerial logs <domain>      Tail the station's service logs",
    "  aerial upgrade <domain>   Upgrade a station to this CLI's pinned release",
    "",
    "  aerial --version | -v     Print version",
    "  aerial --help   | -h      This help",
  ].join("\n");
}

/** stderr message + usage, exit 2 (bad invocation, distinct from runtime failure). */
function usageError(message: string): never {
  process.stderr.write(`${message}\n\n${usage()}\n`);
  process.exit(2);
}

const domainCommands = {
  down: downCommand,
  ssh: sshCommand,
  logs: logsCommand,
  upgrade: upgradeCommand,
} as const;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === undefined || cmd === "-h" || cmd === "--help") {
    console.log(usage());
    process.exit(0);
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(CLI_VERSION);
    process.exit(0);
  }

  const ctx: Ctx = {
    prompter: clackPrompter(),
    shell: nodeShell(),
    fetch: globalThis.fetch.bind(globalThis),
    platform: process.platform,
    paths: defaultPaths(),
  };

  try {
    if (cmd === "up") {
      let size: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--size") {
          size = rest[i + 1];
          if (size === undefined) usageError("aerial up: --size needs a value (like cpx11)");
          i++;
        } else {
          usageError(`aerial up: unknown option '${rest[i]}'`);
        }
      }
      await upCommand(ctx, { size });
    } else if (cmd === "ls") {
      await lsCommand(ctx);
    } else if (cmd in domainCommands) {
      const domain = rest[0];
      if (domain === undefined) usageError(`aerial ${cmd} needs a station domain`);
      await domainCommands[cmd as keyof typeof domainCommands](ctx, domain);
    } else {
      usageError(`aerial: unknown command '${cmd}'`);
    }
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`✗ ${err.message}\n`);
      if (err.hint) process.stderr.write(`  ↳ ${err.hint}\n`);
      process.exit(1);
    }
    process.stderr.write(`${err instanceof Error ? (err.stack ?? String(err)) : String(err)}\n`);
    process.exit(1);
  }
}

void main();
