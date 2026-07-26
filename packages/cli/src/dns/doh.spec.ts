import { describe, expect, it, vi } from "vitest";
import { CliError } from "../context";
import { resolveDoh } from "./doh";

type Fetch = typeof globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const fetchWith = (body: unknown, status = 200) =>
  vi.fn(async (_input: Parameters<typeof fetch>[0]) => json(body, status));

describe("resolveDoh", () => {
  it("GETs dns.google/resolve with the name and type", async () => {
    const f = fetchWith({ Status: 0, Answer: [{ type: 1, data: "1.2.3.4" }] });
    await resolveDoh(f as unknown as Fetch, "example.com", "A");
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe(
      "https://dns.google/resolve?name=example.com&type=A",
    );
  });

  it("URL-encodes the queried name", async () => {
    const f = fetchWith({ Status: 0 });
    await resolveDoh(f as unknown as Fetch, "weird&name", "A");
    expect(String(f.mock.calls[0][0])).toBe(
      "https://dns.google/resolve?name=weird%26name&type=A",
    );
  });

  it("returns the data of A answers", async () => {
    const f = fetchWith({
      Status: 0,
      Answer: [
        { type: 1, data: "1.2.3.4" },
        { type: 1, data: "5.6.7.8" },
      ],
    });
    await expect(resolveDoh(f as unknown as Fetch, "example.com", "A")).resolves.toEqual([
      "1.2.3.4",
      "5.6.7.8",
    ]);
  });

  it("filters out answers of other types (e.g. CNAMEs in the chain)", async () => {
    const f = fetchWith({
      Status: 0,
      Answer: [
        { type: 5, data: "alias.example.com." },
        { type: 1, data: "1.2.3.4" },
      ],
    });
    await expect(resolveDoh(f as unknown as Fetch, "example.com", "A")).resolves.toEqual([
      "1.2.3.4",
    ]);
  });

  it("matches AAAA answers by numeric type 28", async () => {
    const f = fetchWith({
      Status: 0,
      Answer: [
        { type: 28, data: "2606:4700::1" },
        { type: 1, data: "1.2.3.4" },
      ],
    });
    await expect(resolveDoh(f as unknown as Fetch, "example.com", "AAAA")).resolves.toEqual([
      "2606:4700::1",
    ]);
    expect(String(f.mock.calls[0][0])).toContain("type=AAAA");
  });

  it("lowercases NS answers and strips trailing dots", async () => {
    const f = fetchWith({
      Status: 0,
      Answer: [
        { type: 2, data: "NS1.Example.COM." },
        { type: 2, data: "ns2.example.com." },
      ],
    });
    await expect(resolveDoh(f as unknown as Fetch, "example.com", "NS")).resolves.toEqual([
      "ns1.example.com",
      "ns2.example.com",
    ]);
  });

  it("strips trailing dots from MX data but preserves case and priority", async () => {
    const f = fetchWith({
      Status: 0,
      Answer: [{ type: 15, data: "10 Mail.Example.com." }],
    });
    await expect(resolveDoh(f as unknown as Fetch, "example.com", "MX")).resolves.toEqual([
      "10 Mail.Example.com",
    ]);
  });

  it("returns [] on NXDOMAIN (Status != 0)", async () => {
    const f = fetchWith({ Status: 3 });
    await expect(resolveDoh(f as unknown as Fetch, "gone.example.com", "A")).resolves.toEqual(
      [],
    );
  });

  it("returns [] when Status is 0 but there is no Answer", async () => {
    const f = fetchWith({ Status: 0 });
    await expect(resolveDoh(f as unknown as Fetch, "example.com", "MX")).resolves.toEqual([]);
  });

  it("skips malformed answer entries", async () => {
    const f = fetchWith({
      Status: 0,
      Answer: [null, { type: 1 }, { type: 1, data: 42 }, { type: 1, data: "1.2.3.4" }],
    });
    await expect(resolveDoh(f as unknown as Fetch, "example.com", "A")).resolves.toEqual([
      "1.2.3.4",
    ]);
  });

  it("throws CliError with a connectivity hint when fetch rejects", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const err: unknown = await resolveDoh(f as unknown as Fetch, "example.com", "A").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).hint).toMatch(/connectivity/i);
  });

  it("throws CliError on a non-2xx HTTP response", async () => {
    const f = fetchWith({}, 502);
    await expect(resolveDoh(f as unknown as Fetch, "example.com", "A")).rejects.toBeInstanceOf(
      CliError,
    );
  });

  it("throws CliError when the body is not JSON", async () => {
    const f = vi.fn(async () => new Response("<html>", { status: 200 }));
    await expect(resolveDoh(f as unknown as Fetch, "example.com", "A")).rejects.toBeInstanceOf(
      CliError,
    );
  });
});
