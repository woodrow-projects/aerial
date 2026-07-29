import { z } from "zod";
import { clockSlotInputSchema } from "@aerial/shared";

/**
 * Body for `PATCH /api/clocks/:id`. Both fields are optional (PATCH semantics):
 * when `slots` is present the full slot array is replaced atomically (min 1,
 * contiguous positions validated in the service). Kept local to this module (not
 * in @aerial/shared) until the SPA needs the type — mirrors playlists.schema.ts.
 * `createClockSchema` (name + slots, both required) lives in @aerial/shared.
 */
export const updateClockSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  slots: z.array(clockSlotInputSchema).min(1, "a clock needs at least one slot").optional(),
});
export type UpdateClockInput = z.infer<typeof updateClockSchema>;
