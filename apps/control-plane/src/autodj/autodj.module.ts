import { Module } from "@nestjs/common";
import { ShowsModule } from "../shows/shows.module";
import { NextTrackService } from "./next-track.service";
import { PlaylogController } from "./playlog.controller";

/**
 * Auto-DJ playout (ADR D17). Owns the deterministic next-track queue and the decision
 * log read. Imports ShowsModule for ScheduleService (resolve the active clock).
 * NextTrackService is exported so the orchestrator's InternalController can serve
 * POST /internal/next-track from it. PrismaModule is @Global — not imported here.
 */
@Module({
  imports: [ShowsModule],
  controllers: [PlaylogController],
  providers: [NextTrackService],
  exports: [NextTrackService],
})
export class AutodjModule {}
