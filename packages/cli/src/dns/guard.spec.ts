import { describe, expect, it, vi } from "vitest";
import { CliError } from "../context";
import {
  looksLikeSubdomain,
  pollForA,
  pollForNs,
  probeDomainInUse,
  type PollOpts,
} from "./guard";

type Fetch = typeof globalThis.fetch;

const CODE: Record<string, number> = { A: 1, AAAA: 28, MX: 15, NS: 2 };

/** Fake DoH endpoint: table[`${type} ${name}`] -> answer data list. */
const dohTable = (table: Record<string, string[]>) =>
  vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const u = new URL(String(input));
    const name = u.searchParams.get("name") ?? "";
    const type = u.searchParams.get("type") ?? "";
    const data = table[`${type} ${name}`] ?? [];
    const body =
      data.length === 0
        ? { Status: 3 }
        : { Status: 0, Answer: data.map((d) => ({ type: CODE[type], data: d })) };
    return new Response(JSON.stringify(body), { status: 200 });
  });

/** DoH fetch whose nth call yields results[n] (last entry sticky); Error entries reject. */
const dohSequence = (results: Array<string[] | Error>, code = 1) => {
  let i = 0;
  return vi.fn(async () => {
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    if (r instanceof Error) throw r;
    return new Response(
      JSON.stringify({ Status: 0, Answer: r.map((d) => ({ type: code, data: d })) }),
      { status: 200 },
    );
  });
};

const opts = (over: Partial<PollOpts> = {}): PollOpts => ({
  timeoutMs: 60_000,
  intervalMs: 1_000,
  sleep: vi.fn(async () => {}),
  ...over,
});

describe("looksLikeSubdomain", () => {
  it("is false for an apex domain", () => {
    expect(looksLikeSubdomain("example.com")).toBe(false);
  });

  it("is true for three labels", () => {
    expect(looksLikeSubdomain("radio.example.com")).toBe(true);
  });

  it("is true for deeper names", () => {
    expect(looksLikeSubdomain("a.b.c.example.com")).toBe(true);
  });

  it("ignores a trailing dot", () => {
    expect(looksLikeSubdomain("example.com.")).toBe(false);
  });
});

describe("probeDomainInUse", () => {
  it("queries apex A, apex AAAA, apex MX and www A", async () => {
    const f = dohTable({});
    await probeDomainInUse(f as unknown as Fetch, "example.com");
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "https://dns.google/resolve?name=example.com&type=A",
      "https://dns.google/resolve?name=example.com&type=AAAA",
      "https://dns.google/resolve?name=example.com&type=MX",
      "https://dns.google/resolve?name=www.example.com&type=A",
    ]);
  });

  it("reports a clean domain as not in use", async () => {
    const f = dohTable({});
    await expect(probeDomainInUse(f as unknown as Fetch, "example.com")).resolves.toEqual({
      inUse: false,
      hits: [],
    });
  });

  it("collects hits from every record type, MX priority stripped", async () => {
    const f = dohTable({
      "A example.com": ["1.2.3.4"],
      "AAAA example.com": ["2606:4700::1"],
      "MX example.com": ["10 Mail.Example.com."],
      "A www.example.com": ["5.6.7.8"],
    });
    await expect(probeDomainInUse(f as unknown as Fetch, "example.com")).resolves.toEqual({
      inUse: true,
      hits: ["A 1.2.3.4", "AAAA 2606:4700::1", "MX Mail.Example.com", "www A 5.6.7.8"],
    });
  });

  it("ignores a null MX (RFC 7505 'no mail')", async () => {
    const f = dohTable({ "MX example.com": ["0 ."] });
    await expect(probeDomainInUse(f as unknown as Fetch, "example.com")).resolves.toEqual({
      inUse: false,
      hits: [],
    });
  });

  it("propagates resolver failure as CliError (connectivity is not 'not in use')", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      probeDomainInUse(f as unknown as Fetch, "example.com"),
    ).rejects.toBeInstanceOf(CliError);
  });
});

describe("pollForA", () => {
  it("returns true once the expected IP appears", async () => {
    const f = dohSequence([[], [], ["1.2.3.4"]]);
    const sleep = vi.fn(async () => {});
    const onTick = vi.fn();
    await expect(
      pollForA(f as unknown as Fetch, "example.com", "1.2.3.4", opts({ sleep, onTick })),
    ).resolves.toBe(true);
    expect(onTick.mock.calls).toEqual([[1], [2], [3]]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("keeps polling when only other IPs resolve, then times out", async () => {
    const f = dohSequence([["9.9.9.9"]]);
    await expect(
      pollForA(
        f as unknown as Fetch,
        "example.com",
        "1.2.3.4",
        opts({ timeoutMs: 1_000, intervalMs: 400 }),
      ),
    ).resolves.toBe(false);
    // attempts at 0 / 400 / 800ms of accumulated interval time
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("treats a resolver CliError as a miss and keeps polling", async () => {
    const f = dohSequence([new TypeError("fetch failed"), ["1.2.3.4"]]);
    await expect(
      pollForA(f as unknown as Fetch, "example.com", "1.2.3.4", opts()),
    ).resolves.toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("returns false when nothing ever resolves", async () => {
    const f = dohSequence([[]]);
    await expect(
      pollForA(
        f as unknown as Fetch,
        "example.com",
        "1.2.3.4",
        opts({ timeoutMs: 1_000, intervalMs: 500 }),
      ),
    ).resolves.toBe(false);
  });
});

describe("pollForNs", () => {
  it("matches case- and trailing-dot-insensitively", async () => {
    const f = dohSequence([["Hydrogen.NS.Hetzner.COM."]], CODE.NS);
    await expect(
      pollForNs(
        f as unknown as Fetch,
        "example.com",
        ["hydrogen.ns.hetzner.com."],
        opts(),
      ),
    ).resolves.toBe(true);
  });

  it("succeeds when ANY expected NS appears (resolvers may return a partial set)", async () => {
    const f = dohSequence([["ns2.provider.example", "unrelated.example"]], CODE.NS);
    await expect(
      pollForNs(
        f as unknown as Fetch,
        "example.com",
        ["ns1.provider.example", "ns2.provider.example"],
        opts(),
      ),
    ).resolves.toBe(true);
  });

  it("returns false when no expected NS ever appears", async () => {
    const f = dohSequence([["other.dns.example"]], CODE.NS);
    await expect(
      pollForNs(
        f as unknown as Fetch,
        "example.com",
        ["ns1.provider.example"],
        opts({ timeoutMs: 900, intervalMs: 300 }),
      ),
    ).resolves.toBe(false);
    // attempts at 0/300/600/900 — the attempt AT the deadline still runs
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("treats a resolver CliError as a miss", async () => {
    const f = dohSequence([new TypeError("fetch failed"), ["ns1.provider.example"]], CODE.NS);
    await expect(
      pollForNs(f as unknown as Fetch, "example.com", ["ns1.provider.example"], opts()),
    ).resolves.toBe(true);
  });
});
