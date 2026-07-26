/**
 * Best-effort registrar lookup via RDAP (rdap.org redirects to the registry's
 * authoritative server; fetch follows). Only decorates the "set these
 * nameservers at your registrar" instruction — every failure path returns
 * null, never throws.
 */

export async function registrarHint(
  fetch: typeof globalThis.fetch,
  domain: string,
): Promise<{ name?: string; url?: string } | null> {
  // Registrable domain = last two labels. Naive (no PSL): "radio.example.co.uk"
  // yields "co.uk" and the lookup just falls through to null. Accepted for a hint.
  const registrable = domain.replace(/\.$/, "").split(".").slice(-2).join(".");
  try {
    const res = await fetch(`https://rdap.org/domain/${registrable}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const entities = (body as { entities?: unknown }).entities;
    if (!Array.isArray(entities)) return null;
    const registrar = (entities as Array<Record<string, unknown> | null>).find(
      (e) => e !== null && Array.isArray(e.roles) && e.roles.includes("registrar"),
    );
    if (!registrar) return null;

    const name = vcardFn(registrar.vcardArray);
    const url = webLink(registrar.links);
    if (!name && !url) return null;
    const hint: { name?: string; url?: string } = {};
    if (name) hint.name = name;
    if (url) hint.url = url;
    return hint;
  } catch {
    return null;
  }
}

/** vcardArray = ["vcard", [["fn", {}, "text", "<registrar name>"], …]] */
function vcardFn(vcard: unknown): string | undefined {
  if (!Array.isArray(vcard) || !Array.isArray(vcard[1])) return undefined;
  for (const prop of vcard[1]) {
    if (Array.isArray(prop) && prop[0] === "fn" && typeof prop[3] === "string" && prop[3]) {
      return prop[3];
    }
  }
  return undefined;
}

function webLink(links: unknown): string | undefined {
  if (!Array.isArray(links)) return undefined;
  for (const link of links as Array<Record<string, unknown> | null>) {
    if (link === null) continue;
    const { rel, href } = link;
    if (
      (rel === "related" || rel === "about") &&
      typeof href === "string" &&
      /^https?:\/\//i.test(href)
    ) {
      return href;
    }
  }
  return undefined;
}
