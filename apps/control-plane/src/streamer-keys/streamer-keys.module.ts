import { Module } from "@nestjs/common";
import { ChannelsModule } from "../channels/channels.module";
import { ShowsModule } from "../shows/shows.module";
import { StreamerKeysController } from "./streamer-keys.controller";
import { StreamerKeysService } from "./streamer-keys.service";
import { StreamerAuthService } from "./streamer-auth.service";

/**
 * Streamer keys + schedule-aware ingest auth (ADR D18). `StreamerAuthService` is
 * exported so the orchestrator can wire the harbor /internal/auth hook to it; it
 * consumes ScheduleService (from ShowsModule) for the enforceSchedule gate and the
 * legacy per-channel StreamKeysService (from ChannelsModule) for back-compat
 * fallback. PrismaService is available globally (PrismaModule is @Global).
 */
@Module({
  imports: [ChannelsModule, ShowsModule],
  controllers: [StreamerKeysController],
  providers: [StreamerKeysService, StreamerAuthService],
  exports: [StreamerKeysService, StreamerAuthService],
})
export class StreamerKeysModule {}
