import { describe, expect, it, vi } from "vitest";
import { registrarHint } from "./rdap";

type Fetch = typeof globalThis.fetch;

const fetchWith = (body: unknown, status = 200) =>
  vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );

const registrarBody = (entity: Record<string, unknown>) => ({
  entities: [
    { roles: ["technical"], vcardArray: ["vcard", [["fn", {}, "text", "NOC"]]] },
    { roles: ["registrar"], ...entity },
  ],
});

describe("registrarHint", () => {
  it("queries rdap.org for the registrable domain (last two labels)", async () => {
    const f = fetchWith({ entities: [] });
    await registrarHint(f as unknown as Fetch, "radio.fm.example.com");
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe("https://rdap.org/domain/example.com");
  });

  it("uses the domain as-is when it is already two labels", async () => {
    const f = fetchWith({ entities: [] });
    await registrarHint(f as unknown as Fetch, "example.com");
    expect(String(f.mock.calls[0][0])).toBe("https://rdap.org/domain/example.com");
  });

  it("returns the registrar's vcard fn and an http(s) related/about link", async () => {
    const f = fetchWith(
      registrarBody({
        vcardArray: [
          "vcard",
          [
            ["version", {}, "text", "4.0"],
            ["fn", {}, "text", "Example Registrar LLC"],
          ],
        ],
        links: [{ rel: "about", href: "https://registrar.example", type: "text/html" }],
      }),
    );
    await expect(registrarHint(f as unknown as Fetch, "example.com")).resolves.toEqual({
      name: "Example Registrar LLC",
      url: "https://registrar.example",
    });
  });

  it("accepts rel 'related' and skips non-http(s) hrefs", async () => {
    const f = fetchWith(
      registrarBody({
        links: [
          { rel: "about", href: "tel:+1.5555555555" },
          { rel: "self", href: "https://rdap.example/entity/1" },
          { rel: "related", href: "http://registrar.example" },
        ],
      }),
    );
    await expect(registrarHint(f as unknown as Fetch, "example.com")).resolves.toEqual({
      url: "http://registrar.example",
    });
  });

  it("returns just the name when there is no usable link", async () => {
    const f = fetchWith(
      registrarBody({ vcardArray: ["vcard", [["fn", {}, "text", "Namecheap, Inc."]]] }),
    );
    await expect(registrarHint(f as unknown as Fetch, "example.com")).resolves.toEqual({
      name: "Namecheap, Inc.",
    });
  });

  it("returns null when the registrar entity has nothing usable", async () => {
    const f = fetchWith(registrarBody({}));
    await expect(registrarHint(f as unknown as Fetch, "example.com")).resolves.toBeNull();
  });

  it("returns null when no entity has the registrar role", async () => {
    const f = fetchWith({ entities: [{ roles: ["registrant"] }] });
    await expect(registrarHint(f as unknown as Fetch, "example.com")).resolves.toBeNull();
  });

  it("returns null on a non-200 response", async () => {
    const f = fetchWith({}, 404);
    await expect(registrarHint(f as unknown as Fetch, "example.com")).resolves.toBeNull();
  });

  it("returns null when fetch rejects (network / timeout)", async () => {
    const f = vi.fn(async () => {
      throw new DOMException("aborted", "TimeoutError");
    });
    await expect(registrarHint(f as unknown as Fetch, "example.com")).resolves.toBeNull();
  });

  it("returns null on a non-JSON body", async () => {
    const f = fetchWith("<html>rate limited</html>");
    await expect(registrarHint(f as unknown as Fetch, "example.com")).resolves.toBeNull();
  });

  it("returns null on malformed RDAP shapes without throwing", async () => {
    for (const body of [null, [], { entities: "nope" }, { entities: [null] }]) {
      const f = fetchWith(body);
      await expect(registrarHint(f as unknown as Fetch, "example.com")).resolves.toBeNull();
    }
  });
});
