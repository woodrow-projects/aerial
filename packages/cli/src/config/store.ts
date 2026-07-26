import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError } from "../context";
import { configFilePath, type Paths } from "../paths";
import type { ProviderId } from "../providers/types";
import {
  cliConfigSchema,
  emptyConfig,
  type CachedStation,
  type CliConfig,
  type LocalStation,
} from "./schema";

export async function loadConfig(paths: Paths): Promise<CliConfig> {
  const file = configFilePath(paths);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig();
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(
      "Config file is not valid JSON.",
      `Fix or delete ${file} and re-run.`,
    );
  }
  const result = cliConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliError(
      "Config file does not match the expected shape.",
      `Fix or delete ${file} and re-run.`,
    );
  }
  return result.data;
}

export async function saveConfig(paths: Paths, cfg: CliConfig): Promise<void> {
  const file = configFilePath(paths);
  await mkdir(paths.configDir, { recursive: true, mode: 0o700 });
  // tmp + rename in the same dir: readers never observe a partial file.
  const tmp = join(
    paths.configDir,
    `.config.json.${randomBytes(6).toString("hex")}.tmp`,
  );
  await writeFile(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
  // Holds provider tokens (ADR D10 posture) — owner-only, regardless of umask.
  await chmod(file, 0o600);
}

export function upsertToken(
  cfg: CliConfig,
  provider: ProviderId,
  token: string,
): CliConfig {
  return { ...cfg, tokens: { ...cfg.tokens, [provider]: token } };
}

export function cacheStation(cfg: CliConfig, station: CachedStation): CliConfig {
  const stations = cfg.stations.filter(
    (s) => !(s.domain === station.domain && s.provider === station.provider),
  );
  return { ...cfg, stations: [...stations, station] };
}

export function removeCachedStation(cfg: CliConfig, domain: string): CliConfig {
  return { ...cfg, stations: cfg.stations.filter((s) => s.domain !== domain) };
}

export function setLocalStation(
  cfg: CliConfig,
  station: LocalStation | null,
): CliConfig {
  return { ...cfg, localStation: station };
}
