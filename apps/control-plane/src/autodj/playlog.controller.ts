import { Controller, Get, Param, Query } from "@nestjs/common";
import { NextTrackService } from "./next-track.service";

/**
 * Read-only "why this track" decision log (ADR D17, plan §Playout). Newest-first
 * PlayLog rows for a channel: which show -> clock -> slot -> playlist produced each
 * served URI. Open to any signed-in operator (the global AuthGuard still applies; no
 * @Roles — reads are not admin-gated). The base path is shared with ChannelsController;
 * the distinct `/playlog` suffix keeps the routes non-overlapping.
 */
@Controller("api/channels")
export class PlaylogController {
  constructor(private readonly nextTrack: NextTrackService) {}

  @Get(":channelId/playlog")
  playlog(@Param("channelId") channelId: string, @Query("limit") limit?: string) {
    return this.nextTrack.playlog(channelId, limit);
  }
}
