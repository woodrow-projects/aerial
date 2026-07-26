import type { CachedStation, CliConfig } from "../config/schema";
import { CliError } from "../context";
import type { Paths } from "../paths";
import { makeProvider as defaultMakeProvider } from "../providers/registry";
import type { CloudProvider, ProviderId } from "../providers/types";
import { PROVIDER_IDS } from "../providers/types";
import type { StationConn } from "../ssh/transport";

export interface ResolveDeps {
  makeProvider?: typeof defaultMakeProvider;
}

export interface ResolvedStation {
  conn: StationConn;
  provider: CloudProvider;
  providerId: ProviderId;
  /** Present when the local cache knew the station (carries dnsMode). */
  cached?: CachedStation;
}

/**
 * Cache first (fast path), then truth: label-query every tokened provider
 * (ADR D16 — the provider is the database; the cache is a convenience).
 */
export async function resolveStation(
  ctx: { fetch: typeof globalThis.fetch; paths: Paths },
  cfg: CliConfig,
  domain: string,
  deps: ResolveDeps = {},
): Promise<ResolvedStation> {
  const make = deps.makeProvider ?? defaultMakeProvider;

  const cached = cfg.stations.find((s) => s.domain === domain);
  if (cached) {
    const token = cfg.tokens[cached.provider];
    if (!token) {
      throw new CliError(
        `Station ${domain} is on ${cached.provider}, but no ${cached.provider} API token is saved.`,
        "Run `aerial up` once to save a token for that provider.",
      );
    }
    const provider = make(cached.provider, { token, fetch: ctx.fetch });
    return {
      conn: { domain, ipv4: cached.ipv4, paths: ctx.paths },
      provider,
      providerId: cached.provider,
      cached,
    };
  }

  // One provider's stale token must not hide a station on the next provider.
  const problems: string[] = [];
  for (const id of PROVIDER_IDS) {
    const token = cfg.tokens[id];
    if (!token) continue;
    const provider = make(id, { token, fetch: ctx.fetch });
    let found;
    try {
      found = (await provider.listStations()).find((s) => s.domain === domain);
    } catch (err) {
      problems.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (found) {
      return { conn: { domain, ipv4: found.ipv4, paths: ctx.paths }, provider, providerId: id };
    }
  }

  throw new CliError(
    problems.length
      ? `No station named ${domain} found — and some providers couldn't be checked (${problems.join("; ")}).`
      : `No station named ${domain} found at any provider with a saved token.`,
    "See what exists with `aerial ls`.",
  );
}
