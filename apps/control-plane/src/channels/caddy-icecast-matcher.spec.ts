import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { slugSchema } from "@aerial/shared";

/**
 * The edge must proxy ONLY per-channel Icecast mounts.
 *
 * `channels.service.ts` advertises `${origin}/icecast/${slug}` — a single
 * kebab-case path segment. Everything else under `/icecast/*` is Icecast's own
 * web root and admin surface (`status.xsl`, `status-json.xsl`, `/admin/stats.xml`),
 * which serve per-mount listener counts and now-playing metadata WITHOUT
 * authentication. Proxying the whole URL space published those on every install.
 *
 * This pins the Caddyfile allow-list against `slugSchema`, which is the coupling
 * that would otherwise rot silently: widen the slug rules and valid mounts start
 * 404ing at the edge, with nothing in the TypeScript build to catch it.
 */

function findCaddyfile(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, "deploy/caddy/Caddyfile");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("deploy/caddy/Caddyfile not found from " + process.cwd());
}

const caddyfile = readFileSync(findCaddyfile(), "utf8");

/** The `@name path_regexp <pattern>` guarding the Icecast route. */
function icecastMatcher(): RegExp {
  const line = caddyfile
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("@") && l.includes("path_regexp") && l.includes("/icecast/"));
  if (!line) throw new Error("no `path_regexp` matcher for /icecast/ in the Caddyfile");
  const pattern = line.split(/\s+/).pop();
  if (!pattern) throw new Error(`could not read the pattern out of: ${line}`);
  return new RegExp(pattern);
}

describe("Caddy /icecast/* allow-list", () => {
  it("does not proxy the whole Icecast URL space", () => {
    // `handle_path /icecast/*` with no matcher forwards status-json.xsl and
    // /admin/* straight through. That is the bug this guards.
    const permissive = caddyfile
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("handle_path /icecast/"));
    expect(permissive).toEqual([]);
  });

  const validSlugs = [
    "ab",
    "main",
    "talk-radio",
    "a1-b2-c3",
    "0",
    "channel2",
    "x".repeat(48),
    "a-very-long-kebab-case-channel-slug-that-is-valid",
  ].filter((s) => slugSchema.safeParse(s).success);

  it.each(validSlugs)("admits the advertised mount path for slug %s", (slug) => {
    expect(icecastMatcher().test(`/icecast/${slug}`)).toBe(true);
  });

  // Every path here is reachable on a stock Icecast and leaks operational data
  // or exposes an admin action.
  it.each([
    "/icecast/",
    "/icecast/status.xsl",
    "/icecast/status-json.xsl",
    "/icecast/server_version.xsl",
    "/icecast/admin/stats.xml",
    "/icecast/admin/listclients?mount=/main",
    "/icecast/admin/killsource?mount=/main",
    "/icecast/main/../admin/stats.xml",
    "/icecast/style.css",
  ])("refuses %s", (path) => {
    expect(icecastMatcher().test(path)).toBe(false);
  });

  it("admits every slug slugSchema accepts", () => {
    // The invariant that matters is one-directional: no slug the API will accept
    // may 404 at the edge. The matcher is deliberately laxer on length (Caddyfile
    // tokens can't carry `{2,48}` — braces are placeholder syntax), which is the
    // safe direction: an out-of-range path just reaches a mount Icecast doesn't
    // have. Widening slugSchema's *character* set without widening the matcher is
    // what this catches.
    const matcher = icecastMatcher();
    const accepted = [
      "ab",
      "zz",
      "a-b",
      "9-9",
      "abc-123-xyz",
      "q".repeat(48),
      "0a",
      "main2",
    ].filter((s) => slugSchema.safeParse(s).success);

    expect(accepted.length).toBeGreaterThan(6);
    for (const slug of accepted) {
      expect(matcher.test(`/icecast/${slug}`), `slug ${slug} must reach Icecast`).toBe(true);
    }
  });
});
