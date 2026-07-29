import { z } from "zod";
import { daysOfWeekSchema, hhmmSchema } from "@aerial/shared";

/**
 * Local (module-scoped) schemas for the shows module — kept out of @aerial/shared
 * until the SPA needs the types (mirrors clocks.schema.ts / playlists.schema.ts).
 * `createShowSchema` (the discriminated create body) is the shared source of truth.
 */

/**
 * Body for `PATCH /api/channels/:channelId/shows/:showId`. All fields optional
 * (PATCH). `type` is intentionally NOT updatable — swapping scheduled↔live would
 * mean swapping the clock/owner reference; recreate the show instead. `clockId`
 * may only be set on a scheduled show and `ownerId` only on a live show (enforced
 * in the service against the persisted type). `dateStart`/`dateEnd` are nullable so
 * a range bound can be cleared.
 */
export const updateShowSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  startTime: hhmmSchema.optional(),
  endTime: hhmmSchema.optional(),
  daysOfWeek: daysOfWeekSchema.optional(),
  dateStart: z.coerce.date().nullable().optional(),
  dateEnd: z.coerce.date().nullable().optional(),
  priority: z.number().int().optional(),
  clockId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
});
export type UpdateShowInput = z.infer<typeof updateShowSchema>;

/**
 * Query for `GET /api/channels/:channelId/schedule`. `at` (ISO) defaults to "now"
 * in the controller when omitted — the SPA's now/next view.
 */
export const scheduleQuerySchema = z.object({
  at: z.coerce.date().optional(),
});
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;
