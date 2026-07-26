import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Filesystem locations (XDG, opinionated — ADR D12: no "where?" prompts).
 * Bundled as an object so tests can point everything at a temp dir.
 */
export interface Paths {
  /** Tokens + station cache + ssh material: ~/.config/aerial */
  configDir: string;
  /** Local-mode station files (the extracted release): ~/.local/share/aerial/station */
  stationDir: string;
  /** Pre-destroy database snapshots: ~/aerial-backups */
  backupsDir: string;
}

export function defaultPaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = homedir();
  const xdgConfig = env.XDG_CONFIG_HOME || join(home, ".config");
  const xdgData = env.XDG_DATA_HOME || join(home, ".local", "share");
  return {
    configDir: join(xdgConfig, "aerial"),
    stationDir: join(xdgData, "aerial", "station"),
    backupsDir: join(home, "aerial-backups"),
  };
}

export const configFilePath = (p: Paths) => join(p.configDir, "config.json");
export const privateKeyPath = (p: Paths) => join(p.configDir, "id_ed25519");
export const publicKeyPath = (p: Paths) => join(p.configDir, "id_ed25519.pub");
/** Per-station known_hosts (TOFU `accept-new` on first connect). */
export const knownHostsPath = (p: Paths, domain: string) =>
  join(p.configDir, `known_hosts.${domain}`);
