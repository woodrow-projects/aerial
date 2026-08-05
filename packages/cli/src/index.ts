/**
 * aerial — provision a self-hosted radio station anywhere.
 * Wiring only (arg routing + real-dependency construction); all logic lives
 * in commands/ and is unit-tested there. Only this file and prompts.ts may
 * call process.exit.
 */
import { downCommand } from "./commands/down";
import { commandHelp, isCommandName, usage } from "./commands/help";
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
  if (cmd === "help") {
    const topic = rest[0];
    // `help`, `-h`, `--help` as topics are still help requests, not errors.
    if (topic === undefined || topic === "help" || topic === "-h" || topic === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (isCommandName(topic)) {
      console.log(commandHelp(topic));
      process.exit(0);
    }
    usageError(`aerial help: '${topic}' isn't an aerial command`);
  }
  if (isCommandName(cmd) && rest.some((arg) => arg === "-h" || arg === "--help")) {
    console.log(commandHelp(cmd));
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
