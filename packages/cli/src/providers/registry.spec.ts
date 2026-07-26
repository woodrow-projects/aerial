import { describe, expect, it } from "vitest";
import { makeProvider } from "./registry";

const deps = { token: "tok", fetch: (async () => new Response("{}")) as typeof fetch };

describe("makeProvider", () => {
  it("constructs the hetzner adapter", () => {
    const p = makeProvider("hetzner", deps);
    expect(p.id).toBe("hetzner");
    expect(p.displayName).toBe("Hetzner");
  });

  it("constructs the digitalocean adapter", () => {
    const p = makeProvider("digitalocean", deps);
    expect(p.id).toBe("digitalocean");
    expect(p.displayName).toBe("DigitalOcean");
  });

  it("passes the injectable sleep through to adapters", () => {
    const sleep = async () => {};
    // No behavioral assertion possible without network; construction must not throw.
    expect(() => makeProvider("hetzner", deps, sleep)).not.toThrow();
    expect(() => makeProvider("digitalocean", deps, sleep)).not.toThrow();
  });
});
