import { z } from "zod";
import { PROVIDER_IDS } from "../providers/types";

/**
 * ~/.config/aerial/config.json — tokens + a CACHE of known stations.
 * The cache is a convenience only; truth is always reconstructed from
 * provider label queries (ADR D16). Written with mode 0600 (holds tokens).
 */

export const dnsModeSchema = z.enum(["delegation", "a-record"]);
export type DnsMode = z.infer<typeof dnsModeSchema>;

export const cachedStationSchema = z.object({
  domain: z.string().min(1),
  provider: z.enum(PROVIDER_IDS),
  dnsMode: dnsModeSchema,
  ipv4: z.string().min(1),
  createdAt: z.string(),
});
export type CachedStation = z.infer<typeof cachedStationSchema>;

/** At most one local station per machine (fixed XDG station dir). */
export const localStationSchema = z.object({
  dir: z.string().min(1),
  createdAt: z.string(),
});
export type LocalStation = z.infer<typeof localStationSchema>;

export const cliConfigSchema = z.object({
  tokens: z.record(z.enum(PROVIDER_IDS), z.string()).default({}),
  stations: z.array(cachedStationSchema).default([]),
  localStation: localStationSchema.nullable().default(null),
});
export type CliConfig = z.infer<typeof cliConfigSchema>;

export const emptyConfig = (): CliConfig => cliConfigSchema.parse({});
