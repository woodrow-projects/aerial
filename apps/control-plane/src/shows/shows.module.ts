import { Module } from "@nestjs/common";
import { ShowsController } from "./shows.controller";
import { ShowsService } from "./shows.service";
import { ScheduleService } from "./schedule.service";

/**
 * Shows & scheduling (plan Phase C/D). `ScheduleService` is exported because the
 * Auto-DJ queue (next-track) and schedule-aware streamer auth consume its pinned
 * `resolve` / `activeLiveShowFor` contract; the orchestrator wires those imports.
 */
@Module({
  controllers: [ShowsController],
  providers: [ShowsService, ScheduleService],
  exports: [ScheduleService],
})
export class ShowsModule {}
