import { describe, expect, it } from "vitest";
import { CLI_VERSION, PINNED_AERIAL_REF } from "../version";
import { COMMANDS, commandHelp, isCommandName, usage } from "./help";

/** Terminal help must never wrap ugly: hold every line to 80 columns. */
const expectLinesFit = (text: string) => {
  for (const line of text.split("\n")) {
    expect(line.length, `line too long: "${line}"`).toBeLessThanOrEqual(80);
  }
};

describe("usage", () => {
  it("shows the CLI version", () => {
    expect(usage()).toContain(CLI_VERSION);
  });

  it("lists every command", () => {
    for (const cmd of COMMANDS) {
      expect(usage()).toMatch(new RegExp(`^\\s{2}${cmd}\\b`, "m"));
    }
  });

  it("documents the global flags", () => {
    expect(usage()).toMatch(/^\s{2}-v, --version\b/m);
    expect(usage()).toMatch(/^\s{2}-h, --help\b/m);
  });

  it("surfaces the --size option on the up line", () => {
    expect(usage()).toMatch(/^\s{2}up \[--size <id>\]/m);
  });

  it("points at per-command help", () => {
    expect(usage()).toContain("aerial help <command>");
    expect(usage()).toContain("aerial <command> --help");
  });

  it("keeps every line within 80 columns", () => {
    expectLinesFit(usage());
  });
});

describe("commandHelp", () => {
  it("opens with the command name and includes a Usage section", () => {
    for (const cmd of COMMANDS) {
      const help = commandHelp(cmd);
      expect(help.startsWith(`aerial ${cmd} — `), `${cmd} header`).toBe(true);
      expect(help, `${cmd} usage section`).toContain("Usage:");
      expect(help, `${cmd} usage line`).toMatch(new RegExp(`^\\s{2}aerial ${cmd}\\b`, "m"));
    }
  });

  it("keeps every line of every command's help within 80 columns", () => {
    for (const cmd of COMMANDS) {
      expectLinesFit(commandHelp(cmd));
    }
  });

  it("up: documents --size, both providers, and local mode", () => {
    const help = commandHelp("up");
    expect(help).toContain("--size <id>");
    expect(help).toContain("Hetzner");
    expect(help).toContain("DigitalOcean");
    expect(help).toContain("http://localhost");
    // The live price appears only on the default-size path (up.ts).
    expect(help).toContain("with --size, no price is shown");
  });

  it("ls: explains where rows come from and what STATUS means", () => {
    const help = commandHelp("ls");
    expect(help).toContain("not a local cache");
    expect(help).toContain("DOMAIN  PROVIDER  REGION  SIZE  IP  STATUS");
    expect(help).toContain("unreachable");
  });

  it("down: warns about permanence, typed confirmation, backups, and local", () => {
    const help = commandHelp("down");
    expect(help).toContain("cannot be undone");
    expect(help).toContain("typing the domain");
    expect(help).toContain("aerial down local");
    expect(help).toContain("aerial-backups");
    // The provider-side DNS zone IS destroyed (discovery includes it).
    expect(help).toContain("DNS zone");
  });

  it("ssh: says it opens a root shell using the machine-wide key", () => {
    const help = commandHelp("ssh");
    expect(help).toContain("root shell");
    // One shared keypair per machine (paths.ts), not one per station.
    expect(help).toContain("machine-wide SSH key");
  });

  it("logs: says how to stop following", () => {
    expect(commandHelp("logs")).toContain("Ctrl-C");
  });

  it("upgrade: names the pinned release and warns about the restart", () => {
    const help = commandHelp("upgrade");
    expect(help).toContain(PINNED_AERIAL_REF);
    expect(help.toLowerCase()).toContain("interruption");
  });
});

describe("isCommandName", () => {
  it("accepts every command", () => {
    for (const cmd of COMMANDS) {
      expect(isCommandName(cmd), cmd).toBe(true);
    }
  });

  it("rejects things that are not commands", () => {
    // "u"/"up "/"upgradee" pin exact-match against prefix/superstring bugs.
    for (const notCmd of ["help", "--help", "-h", "start", "Up", "", "u", "up ", " up", "upgradee"]) {
      expect(isCommandName(notCmd), JSON.stringify(notCmd)).toBe(false);
    }
  });
});
