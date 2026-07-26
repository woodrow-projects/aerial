import { CliError } from "../context";
import { resolveDoh, type DohType } from "./doh";

/**
 * In-use-domain guard + delegation/A-record polling (docs/plans/aerial-cli.md,
 * DNS section). The probe decides the DEFAULT path only — the user can still
 * choose either; the polls gate the install on the record actually resolving.
 */

/**
 * Naive label count — no PSL, so multi-part TLDs ("example.co.uk") are misread
 * as subdomains. Accepted: subdomains default to the A-record path, which is
 * safe for any domain.
 */
export function looksLikeSubdomain(domain: string): boolean {
  return domain.split(".").filter(Boolean).length > 2;
}

/** MX data is "<priority> <host>"; a null MX ("0 .", RFC 7505) means "no mail". */
const mxHost = (data: string) => data.replace(/^\d+\s*/, "");

/**
 * Probe apex A/AAAA/MX and www A. Resolver failure propagates as CliError —
 * "couldn't look" must never be read as "not in use" and green-light a
 * delegation that would orphan existing records.
 */
export async function probeDomainInUse(
  fetch: typeof globalThis.fetch,
  domain: string,
): Promise<{ inUse: boolean; hits: string[] }> {
  const [a, aaaa, mx, wwwA] = await Promise.all([
    resolveDoh(fetch, domain, "A"),
    resolveDoh(fetch, domain, "AAAA"),
    resolveDoh(fetch, domain, "MX"),
    resolveDoh(fetch, `www.${domain}`, "A"),
  ]);
  const hits = [
    ...a.map((ip) => `A ${ip}`),
    ...aaaa.map((ip) => `AAAA ${ip}`),
    ...mx.map(mxHost).filter(Boolean).map((host) => `MX ${host}`),
    ...wwwA.map((ip) => `www A ${ip}`),
  ];
  return { inUse: hits.length > 0, hits };
}

export interface PollOpts {
  timeoutMs: number;
  intervalMs: number;
  /** Injectable for tests (no fake timers needed). */
  sleep?: (ms: number) => Promise<void>;
  onTick?: (attempt: number) => void;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Elapsed time is accounted in interval units (not wall clock) so an instant
 * injected sleep still terminates deterministically.
 */
async function pollUntil(check: () => Promise<boolean>, opts: PollOpts): Promise<boolean> {
  const sleep = opts.sleep ?? realSleep;
  let attempt = 0;
  let elapsed = 0;
  for (;;) {
    attempt += 1;
    opts.onTick?.(attempt);
    if (await check()) return true;
    elapsed += opts.intervalMs;
    if (elapsed > opts.timeoutMs) return false;
    await sleep(opts.intervalMs);
  }
}

/** A resolver CliError is a miss, not a failure — propagation not ready yet. */
async function resolveOrMiss(
  fetch: typeof globalThis.fetch,
  name: string,
  type: DohType,
): Promise<string[]> {
  try {
    return await resolveDoh(fetch, name, type);
  } catch (err) {
    if (err instanceof CliError) return [];
    throw err;
  }
}

export async function pollForA(
  fetch: typeof globalThis.fetch,
  domain: string,
  expectedIp: string,
  opts: PollOpts,
): Promise<boolean> {
  return pollUntil(
    async () => (await resolveOrMiss(fetch, domain, "A")).includes(expectedIp),
    opts,
  );
}

const normalizeNs = (ns: string) => ns.replace(/\.$/, "").toLowerCase();

/** True when ANY expected NS appears — resolvers may return a partial set. */
export async function pollForNs(
  fetch: typeof globalThis.fetch,
  domain: string,
  expectedNs: string[],
  opts: PollOpts,
): Promise<boolean> {
  const expected = new Set(expectedNs.map(normalizeNs));
  return pollUntil(async () => {
    const got = await resolveOrMiss(fetch, domain, "NS");
    return got.some((ns) => expected.has(normalizeNs(ns)));
  }, opts);
}
