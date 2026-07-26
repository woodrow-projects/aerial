import { CliError } from "../context";

/**
 * DNS-over-HTTPS via Google's JSON API. Used instead of node:dns so resolves
 * are deterministic, cache-transparent and injectable in tests — DNS polling
 * is how the CLI babysits the record→TLS ordering (docs/plans/aerial-cli.md).
 */

export type DohType = "A" | "AAAA" | "MX" | "NS";

/** RR type codes as they appear in Answer[].type. */
const TYPE_CODE: Record<DohType, number> = { A: 1, AAAA: 28, MX: 15, NS: 2 };

export async function resolveDoh(
  fetch: typeof globalThis.fetch,
  name: string,
  type: DohType,
): Promise<string[]> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
  const fail = () =>
    new CliError(
      `DNS lookup failed for ${name} (${type})`,
      "Check your internet connectivity and try again.",
    );

  let body: unknown;
  try {
    const res = await fetch(url);
    if (!res.ok) throw fail();
    body = await res.json();
  } catch (err) {
    throw err instanceof CliError ? err : fail();
  }

  if (typeof body !== "object" || body === null) return [];
  const { Status, Answer } = body as { Status?: unknown; Answer?: unknown };
  if (Status !== 0 || !Array.isArray(Answer)) return [];

  const out: string[] = [];
  for (const a of Answer as Array<Record<string, unknown> | null>) {
    if (a === null || a.type !== TYPE_CODE[type] || typeof a.data !== "string") continue;
    const data = a.data.replace(/\.$/, "");
    out.push(type === "NS" ? data.toLowerCase() : data);
  }
  return out;
}
