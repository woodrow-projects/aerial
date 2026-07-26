import { loadConfig } from "../config/store";
import type { Ctx } from "../context";
import { makeProvider as defaultMakeProvider } from "../providers/registry";
import { PROVIDER_IDS } from "../providers/types";

export type StationStatus = "up" | "unreachable";

export type ProbeFn = (
  fetchFn: typeof globalThis.fetch,
  url: string,
) => Promise<StationStatus>;

export interface LsDeps {
  makeProvider?: typeof defaultMakeProvider;
  probe?: ProbeFn;
  print?: (line: string) => void;
}

/** Any HTTP response counts — a 502 still means DNS+TLS+proxy answered. */
async function defaultProbe(
  fetchFn: typeof globalThis.fetch,
  url: string,
): Promise<StationStatus> {
  try {
    await fetchFn(url, { signal: AbortSignal.timeout(4_000) });
    return "up";
  } catch {
    return "unreachable";
  }
}

interface Row {
  domain: string;
  provider: string;
  region: string;
  size: string;
  ip: string;
  status: string;
}

const HEADER: Row = {
  domain: "DOMAIN",
  provider: "PROVIDER",
  region: "REGION",
  size: "SIZE",
  ip: "IP",
  status: "STATUS",
};

/**
 * `aerial ls` — truth from label-filtered provider queries (ADR D16), never
 * the cache, plus this machine's local station. Output goes through the
 * `print` seam because the listing IS the product.
 */
export async function lsCommand(ctx: Ctx, deps: LsDeps = {}): Promise<void> {
  const make = deps.makeProvider ?? defaultMakeProvider;
  const probe = deps.probe ?? defaultProbe;
  const print = deps.print ?? console.log;

  const cfg = await loadConfig(ctx.paths);

  const pending: Array<{ row: Omit<Row, "status">; url: string }> = [];
  const notes: string[] = [];

  for (const id of PROVIDER_IDS) {
    const token = cfg.tokens[id];
    if (!token) continue;
    const provider = make(id, { token, fetch: ctx.fetch });
    try {
      for (const s of await provider.listStations()) {
        pending.push({
          row: {
            domain: s.domain,
            provider: provider.displayName,
            region: s.region,
            size: s.size,
            ip: s.ipv4,
          },
          url: `https://${s.domain}/`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notes.push(`${provider.displayName}: could not reach (${message})`);
    }
  }

  if (cfg.localStation) {
    pending.push({
      row: {
        domain: "local",
        provider: "this machine",
        region: "-",
        size: "-",
        ip: "localhost",
      },
      url: "http://localhost/",
    });
  }

  if (pending.length === 0 && notes.length === 0) {
    print("No stations yet — create one with: aerial up");
    return;
  }

  const rows: Row[] = await Promise.all(
    pending.map(async ({ row, url }) => ({
      ...row,
      status: await probe(ctx.fetch, url),
    })),
  );

  if (rows.length > 0) {
    const all = [HEADER, ...rows];
    const width = (pick: (r: Row) => string) =>
      Math.max(...all.map((r) => pick(r).length));
    const w = {
      domain: width((r) => r.domain),
      provider: width((r) => r.provider),
      region: width((r) => r.region),
      size: width((r) => r.size),
      ip: width((r) => r.ip),
    };
    for (const r of all) {
      print(
        [
          r.domain.padEnd(w.domain),
          r.provider.padEnd(w.provider),
          r.region.padEnd(w.region),
          r.size.padEnd(w.size),
          r.ip.padEnd(w.ip),
          r.status,
        ]
          .join("  ")
          .trimEnd(),
      );
    }
  }

  for (const note of notes) print(note);
}
