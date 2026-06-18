import { BadRequestException, Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { CdnConfig } from "@prisma/client";
import type { CdnConfigDto } from "@aerial/shared";
import { PrismaService } from "../prisma/prisma.service";
import { env } from "../config/env";
import { decryptSecret, encryptSecret } from "../common/crypto";
import { CDN_PROVIDER, type CdnProviderAdapter } from "./provider";

const SINGLETON_ID = 1;

/**
 * One-toggle CDN state machine (SPEC §7.2, ADR D4). Owns the singleton CdnConfig
 * row, encrypts the operator's API key at rest, and drives the
 * disabled → provisioning → active | error lifecycle against a pluggable
 * CdnProviderAdapter (Bunny in v1).
 *
 * Holds an in-memory cache of the active CDN base URL so ChannelsService can
 * resolve HLS endpoints synchronously without a DB read per channel.
 */
@Injectable()
export class CdnService implements OnModuleInit {
  private readonly logger = new Logger(CdnService.name);
  private hlsBase: string | null = null; // https://<zone>.b-cdn.net when active, else null

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CDN_PROVIDER) private readonly provider: CdnProviderAdapter,
  ) {}

  async onModuleInit(): Promise<void> {
    this.refreshCache(await this.load());
  }

  /** HLS base URL: the CDN host when active, otherwise the origin. Synchronous so
   *  channel endpoint construction stays a pure function of cached state (D2). */
  hlsBaseUrl(): string {
    return this.hlsBase ?? env.publicBaseUrl;
  }

  async getStatus(): Promise<CdnConfigDto> {
    return this.toDto(await this.load());
  }

  async setKey(apiKey: string): Promise<CdnConfigDto> {
    const apiKeyEnc = encryptSecret(apiKey);
    const cfg = await this.prisma.cdnConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, apiKeyEnc },
      update: { apiKeyEnc },
    });
    return this.toDto(cfg);
  }

  async enable(): Promise<CdnConfigDto> {
    const cfg = await this.load();
    if (!cfg.apiKeyEnc) throw new BadRequestException("Paste a Bunny API key before enabling the CDN");
    // Already underway or done — return current state (idempotent toggle).
    if (cfg.status === "provisioning" || cfg.status === "active") return this.toDto(cfg);

    const next = await this.prisma.cdnConfig.update({
      where: { id: SINGLETON_ID },
      data: { status: "provisioning", errorMessage: null },
    });
    this.refreshCache(next);
    // Provision out-of-band; the SPA polls GET /api/cdn to watch provisioning → active.
    void this.runProvisioning().catch((err) =>
      this.logger.error(`CDN provisioning failed: ${String((err as Error).message ?? err)}`),
    );
    return this.toDto(next);
  }

  /**
   * The idempotent provisioning step. Persists `pullZoneId` BEFORE calling
   * configure() so a retry (after a crash or transient error) resumes the existing
   * zone instead of creating a duplicate. Transitions to `error` with a message on
   * failure. Public so it can be driven directly in tests against a mock provider.
   */
  async runProvisioning(): Promise<void> {
    const cfg = await this.load();
    if (!cfg.apiKeyEnc) throw new Error("no API key stored");
    const apiKey = decryptSecret(cfg.apiKeyEnc);

    try {
      let pullZoneId = cfg.pullZoneId;
      let cdnHostname = cfg.cdnHostname;

      if (!pullZoneId) {
        const res = await this.provider.provision(apiKey, env.publicBaseUrl);
        pullZoneId = res.pullZoneId;
        cdnHostname = res.cdnHostname;
        // Persist the zone identity immediately, before further config (idempotency).
        await this.prisma.cdnConfig.update({
          where: { id: SINGLETON_ID },
          data: { pullZoneId, cdnHostname },
        });
      }

      await this.provider.configure(apiKey, pullZoneId);

      const done = await this.prisma.cdnConfig.update({
        where: { id: SINGLETON_ID },
        data: { status: "active", cdnHostname, errorMessage: null },
      });
      this.refreshCache(done);
      this.logger.log(`CDN active: HLS now served via ${cdnHostname}`);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const failed = await this.prisma.cdnConfig.update({
        where: { id: SINGLETON_ID },
        data: { status: "error", errorMessage: message },
      });
      this.refreshCache(failed);
      throw err;
    }
  }

  async disable(): Promise<CdnConfigDto> {
    await this.load(); // ensure the row exists
    // Revert HLS endpoints to the origin immediately. Leave the pull zone intact so
    // any embeds already pointing at <zone>.b-cdn.net keep working (plan).
    const cfg = await this.prisma.cdnConfig.update({
      where: { id: SINGLETON_ID },
      data: { status: "disabled", errorMessage: null },
    });
    this.refreshCache(cfg);
    return this.toDto(cfg);
  }

  /** Load (or lazily create) the singleton row. */
  private load(): Promise<CdnConfig> {
    return this.prisma.cdnConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: {},
    });
  }

  private refreshCache(cfg: CdnConfig): void {
    this.hlsBase = cfg.status === "active" && cfg.cdnHostname ? `https://${cfg.cdnHostname}` : null;
  }

  private toDto(cfg: CdnConfig): CdnConfigDto {
    return {
      provider: cfg.provider,
      status: cfg.status,
      hasApiKey: cfg.apiKeyEnc != null,
      cdnHostname: cfg.cdnHostname,
      errorMessage: cfg.errorMessage,
      updatedAt: cfg.updatedAt.toISOString(),
    };
  }
}
