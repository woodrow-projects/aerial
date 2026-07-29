import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { createShowSchema, type CreateShowInput } from "@aerial/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/roles";
import { ShowsService } from "./shows.service";
import { ScheduleService } from "./schedule.service";
import {
  scheduleQuerySchema,
  updateShowSchema,
  type ScheduleQuery,
  type UpdateShowInput,
} from "./shows.schema";

/**
 * Per-channel Show CRUD + the schedule now/next view (plan Phase C/D). Reads are
 * open to any signed-in operator (the schedule calendar reads them); mutations are
 * admin-only (@Roles). Validation is via the shared/local zod schemas through
 * ZodValidationPipe. `channelId` comes from the route; the service owns existence,
 * date-range, and clock/owner reference checks.
 */
@Controller("api/channels/:channelId")
export class ShowsController {
  constructor(
    private readonly shows: ShowsService,
    private readonly schedule: ScheduleService,
  ) {}

  @Get("shows")
  list(@Param("channelId") channelId: string) {
    return this.shows.list(channelId);
  }

  @Get("shows/:showId")
  get(@Param("channelId") channelId: string, @Param("showId") showId: string) {
    return this.shows.get(channelId, showId);
  }

  @Post("shows")
  @Roles("admin")
  create(
    @Param("channelId") channelId: string,
    @Body(new ZodValidationPipe(createShowSchema)) body: CreateShowInput,
  ) {
    return this.shows.create(channelId, body);
  }

  @Patch("shows/:showId")
  @Roles("admin")
  update(
    @Param("channelId") channelId: string,
    @Param("showId") showId: string,
    @Body(new ZodValidationPipe(updateShowSchema)) body: UpdateShowInput,
  ) {
    return this.shows.update(channelId, showId, body);
  }

  @Delete("shows/:showId")
  @Roles("admin")
  @HttpCode(204)
  remove(@Param("channelId") channelId: string, @Param("showId") showId: string) {
    return this.shows.remove(channelId, showId);
  }

  @Get("schedule")
  scheduleNowNext(
    @Param("channelId") channelId: string,
    @Query(new ZodValidationPipe(scheduleQuerySchema)) query: ScheduleQuery,
  ) {
    return this.schedule.nowNext(channelId, query.at ?? new Date());
  }
}
