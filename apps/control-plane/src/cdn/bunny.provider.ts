import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { CdnProvider } from "@aerial/shared";
import type { CdnProviderAdapter, ProvisionResult } from "./provider";

const BUNNY_API = "https://api.bunny.net";

interface BunnyPullZone {
  Id: number;
  Name: string;
  Hostnames?: { Value: string }[];
}

/**
 * Bunny.net pull-zone adapter. Creates a zone whose origin is the Aerial public
 * base URL and returns the free `<zone>.b-cdn.net` hostname (instant TLS, zero DNS
 * — the decision that makes the toggle truly one-step for v1). Cache rules are set
 * to respect the origin's Cache-Control (Caddy already emits `no-cache` for
 * `.m3u8` and immutable for segments).
 *
 * Docs: https://docs.bunny.net/reference/pullzonepublic_add
 */
@Injectable()
export class BunnyProvider implements CdnProviderAdapter {
  readonly id: CdnProvider = "bunny";
  private readonly logger = new Logger(BunnyProvider.name);

  async provision(apiKey: string, originUrl: string): Promise<ProvisionResult> {
    // Bunny zone names are globally unique; a random suffix avoids collisions.
    const name = `aerial-${randomBytes(4).toString("hex")}`;
    const zone = await this.call<BunnyPullZone>(apiKey, "POST", "/pullzone", {
      Name: name,
      OriginUrl: originUrl,
      Type: 0, // 0 = standard HTTP origin pull
    });
    const cdnHostname =
      zone.Hostnames?.find((h) => h.Value?.endsWith(".b-cdn.net"))?.Value ?? `${zone.Name}.b-cdn.net`;
    this.logger.log(`Provisioned Bunny pull zone ${zone.Id} (${cdnHostname}) → origin ${originUrl}`);
    return { pullZoneId: String(zone.Id), cdnHostname };
  }

  async configure(apiKey: string, pullZoneId: string): Promise<void> {
    // Respect origin cache headers (-1 = honour Cache-Control), disable cache
    // slicing (wrong for small HLS segments) and cookies (audio is anonymous).
    await this.call(apiKey, "POST", `/pullzone/${pullZoneId}`, {
      CacheControlMaxAgeOverride: -1,
      CacheControlBrowserMaxAgeOverride: -1,
      EnableCacheSlice: false,
      DisableCookies: true,
    });
    this.logger.log(`Configured Bunny pull zone ${pullZoneId} (respect origin cache headers)`);
  }

  async teardown(apiKey: string, pullZoneId: string): Promise<void> {
    await this.call(apiKey, "DELETE", `/pullzone/${pullZoneId}`);
    this.logger.log(`Deleted Bunny pull zone ${pullZoneId}`);
  }

  private async call<T = unknown>(
    apiKey: string,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${BUNNY_API}${path}`, {
      method,
      headers: {
        AccessKey: apiKey,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Bunny ${method} ${path} failed: ${res.status} ${res.statusText} ${detail}`.trim());
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
