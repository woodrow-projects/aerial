import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../context";
import { configFilePath, type Paths } from "../paths";
import { emptyConfig, type CachedStation, type LocalStation } from "./schema";
import {
  cacheStation,
  loadConfig,
  removeCachedStation,
  saveConfig,
  setLocalStation,
  upsertToken,
} from "./store";

const station: CachedStation = {
  domain: "radio.example.com",
  provider: "hetzner",
  dnsMode: "delegation",
  ipv4: "203.0.113.7",
  createdAt: "2026-07-20T00:00:00.000Z",
};

const local: LocalStation = {
  dir: "/home/u/.local/share/aerial/station",
  createdAt: "2026-07-20T01:00:00.000Z",
};

let root: string;
let paths: Paths;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aerial-store-"));
  paths = {
    configDir: join(root, "config"),
    stationDir: join(root, "station"),
    backupsDir: join(root, "backups"),
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns emptyConfig() when the file does not exist", async () => {
    await expect(loadConfig(paths)).resolves.toEqual(emptyConfig());
  });

  it("throws CliError with the file path in the hint for unparseable JSON", async () => {
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(configFilePath(paths), "{ not json", "utf8");
    const err = await loadConfig(paths).then(
      () => {
        throw new Error("expected loadConfig to reject");
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).hint).toContain(configFilePath(paths));
  });

  it("throws CliError with the file path in the hint when the schema rejects", async () => {
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(configFilePath(paths), '{"tokens":"nope"}', "utf8");
    const err = await loadConfig(paths).then(
      () => {
        throw new Error("expected loadConfig to reject");
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).hint).toContain(configFilePath(paths));
  });
});

describe("saveConfig", () => {
  it("round-trips through loadConfig", async () => {
    const cfg = setLocalStation(
      cacheStation(upsertToken(emptyConfig(), "hetzner", "tok-h"), station),
      local,
    );
    await saveConfig(paths, cfg);
    await expect(loadConfig(paths)).resolves.toEqual(cfg);
  });

  it("creates configDir mode 0700 and config.json mode 0600", async () => {
    await saveConfig(paths, emptyConfig());
    const dir = await stat(paths.configDir);
    const file = await stat(configFilePath(paths));
    expect(dir.mode & 0o777).toBe(0o700);
    expect(file.mode & 0o777).toBe(0o600);
  });

  it("writes via tmp+rename, leaving only config.json behind", async () => {
    await saveConfig(paths, emptyConfig());
    await saveConfig(paths, upsertToken(emptyConfig(), "digitalocean", "tok-d"));
    await expect(readdir(paths.configDir)).resolves.toEqual(["config.json"]);
  });

  it("overwrites an existing config", async () => {
    await saveConfig(paths, upsertToken(emptyConfig(), "hetzner", "old"));
    const next = upsertToken(emptyConfig(), "hetzner", "new");
    await saveConfig(paths, next);
    await expect(loadConfig(paths)).resolves.toEqual(next);
  });
});

describe("pure helpers", () => {
  it("upsertToken sets a token without mutating the input", () => {
    const cfg = emptyConfig();
    const before = structuredClone(cfg);
    const next = upsertToken(cfg, "hetzner", "tok-h");
    expect(next).not.toBe(cfg);
    expect(next.tokens.hetzner).toBe("tok-h");
    expect(cfg).toEqual(before);
  });

  it("upsertToken replaces an existing token for the same provider", () => {
    const cfg = upsertToken(emptyConfig(), "hetzner", "old");
    const next = upsertToken(cfg, "hetzner", "new");
    expect(next.tokens.hetzner).toBe("new");
    expect(cfg.tokens.hetzner).toBe("old");
  });

  it("cacheStation appends a new entry without mutating the input", () => {
    const cfg = emptyConfig();
    const before = structuredClone(cfg);
    const next = cacheStation(cfg, station);
    expect(next.stations).toEqual([station]);
    expect(cfg).toEqual(before);
  });

  it("cacheStation replaces the entry with the same domain+provider", () => {
    const cfg = cacheStation(emptyConfig(), station);
    const updated: CachedStation = { ...station, ipv4: "203.0.113.9" };
    const next = cacheStation(cfg, updated);
    expect(next.stations).toEqual([updated]);
    expect(cfg.stations).toEqual([station]);
  });

  it("cacheStation keeps an entry with the same domain at another provider", () => {
    const other: CachedStation = { ...station, provider: "digitalocean" };
    const next = cacheStation(cacheStation(emptyConfig(), station), other);
    expect(next.stations).toEqual([station, other]);
  });

  it("removeCachedStation drops entries by domain without mutating the input", () => {
    const other: CachedStation = { ...station, domain: "b.example.com" };
    const cfg = cacheStation(cacheStation(emptyConfig(), station), other);
    const before = structuredClone(cfg);
    const next = removeCachedStation(cfg, station.domain);
    expect(next.stations).toEqual([other]);
    expect(cfg).toEqual(before);
  });

  it("setLocalStation sets and clears without mutating the input", () => {
    const cfg = emptyConfig();
    const before = structuredClone(cfg);
    const set = setLocalStation(cfg, local);
    expect(set.localStation).toEqual(local);
    expect(cfg).toEqual(before);
    const cleared = setLocalStation(set, null);
    expect(cleared.localStation).toBeNull();
    expect(set.localStation).toEqual(local);
  });
});
