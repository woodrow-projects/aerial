import { Module } from "@nestjs/common";
import { CdnController } from "./cdn.controller";
import { CdnService } from "./cdn.service";
import { BunnyProvider } from "./bunny.provider";
import { CDN_PROVIDER } from "./provider";

/**
 * CDN auto-provisioning (ADR D4). The active adapter is bound to CDN_PROVIDER —
 * swap this one line to ship Gcore/CDN77/Cloudflare. CdnService is exported so
 * ChannelsService can resolve the HLS base URL (CDN host when active, else origin).
 */
@Module({
  controllers: [CdnController],
  providers: [CdnService, BunnyProvider, { provide: CDN_PROVIDER, useExisting: BunnyProvider }],
  exports: [CdnService],
})
export class CdnModule {}
