import { z } from "zod";

/**
 * Body for `PUT /api/playlists/:id/tracks` — the full ordered membership. The
 * array order IS the position; an empty array clears the playlist. Kept local to
 * this module (not in @aerial/shared) until the SPA needs the type.
 */
export const setPlaylistTracksSchema = z.object({
  trackIds: z.array(z.string().min(1)),
});
export type SetPlaylistTracksInput = z.infer<typeof setPlaylistTracksSchema>;
