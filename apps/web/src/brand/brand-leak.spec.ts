import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

/**
 * BRAND CONTAINMENT GUARD (owner requirement).
 *
 * A future rebrand must touch ONLY `src/brand/*` (+ index.html title/favicon).
 * This scan enforces the contract: no source file OUTSIDE `src/brand/` may
 * contain the product name literal, a raw hex colour, or an oklch colour —
 * everything else consumes APP_NAME/Logo and the theme tokens instead. If this
 * fails, brand identity has leaked out of the swappable module.
 *
 * This spec lives inside `src/brand/` so its own use of the literals (in the
 * patterns below) is excluded from the scan.
 */

const brandDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(brandDir, "..");

const PRODUCT_NAME = "Aerial";
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const OKLCH_COLOR = /oklch\(/i;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (full === brandDir) continue; // the brand module is where identity is allowed to live
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx|css)$/.test(entry)) continue;
    if (/\.spec\.(ts|tsx)$/.test(entry)) continue; // test code is not shipped source
    out.push(full);
  }
  return out;
}

describe("brand containment", () => {
  const files = sourceFiles(srcDir);

  it("scans a non-trivial set of source files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("no source file outside src/brand names the product", () => {
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(PRODUCT_NAME));
    expect(offenders, `product name leaked into:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no source file outside src/brand hard-codes a colour", () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return HEX_COLOR.test(src) || OKLCH_COLOR.test(src);
    });
    expect(offenders, `raw colour leaked into:\n${offenders.join("\n")}`).toEqual([]);
  });
});
