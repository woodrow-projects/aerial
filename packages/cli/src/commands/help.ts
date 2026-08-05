import { CLI_VERSION, PINNED_AERIAL_REF } from "../version";

export const COMMANDS = ["up", "ls", "down", "ssh", "logs", "upgrade"] as const;
export type CommandName = (typeof COMMANDS)[number];

export function isCommandName(value: string): value is CommandName {
  return (COMMANDS as readonly string[]).includes(value);
}

/** `aerial` / `aerial --help` — the overview. All text ≤ 80 columns. */
export function usage(): string {
  return [
    `aerial ${CLI_VERSION} — self-hosted online radio, one command`,
    "",
    "Usage:",
    "  aerial <command> [arguments]",
    "",
    "Commands:",
    "  up [--size <id>]    Create a station — on a cloud VM or this machine",
    "  ls                  List stations across providers, plus this machine",
    "  down <domain>       Destroy a station permanently (typed confirmation)",
    "  ssh <domain>        Open a root shell on the station's VM",
    "  logs <domain>       Follow the station's service logs live",
    "  upgrade <domain>    Move a station to this CLI's pinned release",
    "",
    "Flags:",
    "  -v, --version       Print the CLI version",
    "  -h, --help          Show this help",
    "",
    "Run `aerial help <command>` (or `aerial <command> --help`) for details.",
  ].join("\n");
}

const HELP: Record<CommandName, string> = {
  up: [
    "aerial up — create a station on a cloud VM or this machine",
    "",
    "Usage:",
    "  aerial up [--size <id>]",
    "",
    "An interactive walkthrough — every step is a prompt, so no other",
    "arguments are needed. First you choose where the station runs:",
    "",
    "  Cloud VM (recommended)  Provisions a fresh VM on Hetzner or",
    "                          DigitalOcean with an API token from your",
    "                          provider account. You pick the domain, choose",
    "                          how DNS is set up (aerial manages it, or you",
    "                          add a single A record), and confirm the VM",
    "                          size before anything is created. TLS",
    "                          certificates are automatic.",
    "  This machine            Runs the station locally with Docker at",
    "                          http://localhost — good for trying aerial",
    "                          out. One local station per machine.",
    "",
    "Along the way you create the admin account you'll sign in with.",
    "Provider tokens are saved (in ~/.config/aerial), so your next `up`",
    "skips straight past them.",
    "",
    "Options:",
    "  --size <id>   VM size slug from your provider (like cpx11). Without",
    "                it, the provider's default size is offered with a live",
    "                monthly price; with --size, no price is shown.",
    "",
    "If anything fails partway, aerial offers to destroy what was already",
    "created — nothing is left running silently.",
  ].join("\n"),

  ls: [
    "aerial ls — list stations across providers, plus this machine",
    "",
    "Usage:",
    "  aerial ls",
    "",
    "Asks every cloud provider you have a saved token for which stations",
    "exist right now (the live answer, not a local cache), adds this",
    "machine's local station if there is one, and prints one row each:",
    "",
    "  DOMAIN  PROVIDER  REGION  SIZE  IP  STATUS",
    "",
    "STATUS is a quick HTTP probe of each station: `up` means it answered,",
    "`unreachable` means it didn't — the VM may still be installing, be",
    "stopped, or DNS may still be propagating.",
  ].join("\n"),

  down: [
    "aerial down — destroy a station permanently",
    "",
    "Usage:",
    "  aerial down <domain>",
    "  aerial down local",
    "",
    "Destroys everything that belongs to the station — the VM, its",
    "firewall, and any DNS zone aerial created — and with it all accounts,",
    "channels, stream keys, and listener history. This cannot be undone,",
    "so:",
    "",
    "  - You confirm by typing the domain in full — there is no --force.",
    "  - First, aerial offers to save a copy of the station's database",
    "    to ~/aerial-backups.",
    "",
    "`aerial down local` removes the local station instead (its Docker",
    "containers, volume, and files).",
    "",
    "What gets destroyed is discovered live from the provider, so `down`",
    "also cleans up a station whose `up` failed partway. One loose end",
    "stays behind at your registrar or DNS host: aerial reminds you to",
    "undo the nameserver change or A record yourself.",
  ].join("\n"),

  ssh: [
    "aerial ssh — open a shell on a station's VM",
    "",
    "Usage:",
    "  aerial ssh <domain>",
    "",
    "Opens an interactive root shell on the VM behind <domain>, using the",
    "machine-wide SSH key aerial keeps in ~/.config/aerial (one key,",
    "shared by every station you create). Leave with `exit` or Ctrl-D.",
    "",
    "The local station runs in Docker on this machine — there is no VM to",
    "ssh into.",
  ].join("\n"),

  logs: [
    "aerial logs — follow a station's service logs",
    "",
    "Usage:",
    "  aerial logs <domain>",
    "",
    "Streams the logs of every service on the station to your terminal:",
    "the last 200 lines, then live as they happen. Stop with Ctrl-C — the",
    "station keeps running.",
  ].join("\n"),

  upgrade: [
    "aerial upgrade — move a station to this CLI's release",
    "",
    "Usage:",
    "  aerial upgrade <domain>",
    "",
    "Each CLI version is pinned to one aerial release — this CLI installs",
    `and upgrades stations to ${PINNED_AERIAL_REF}, a combination that was tested`,
    "together. Upgrading rebuilds and restarts the station's services, so",
    "expect a short stream interruption; you are asked to confirm before",
    "anything happens.",
    "",
    "To go further later, update the CLI itself first, then run",
    "`aerial upgrade` again.",
  ].join("\n"),
};

/** `aerial help <command>` / `aerial <command> --help` — the detail page. */
export function commandHelp(command: CommandName): string {
  return HELP[command];
}
