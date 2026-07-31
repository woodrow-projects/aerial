import { describe, expect, it } from "vitest";
import { RolesGuard } from "./roles";
import { ChannelsController } from "../channels/channels.controller";
import { CdnController } from "../cdn/cdn.controller";
import { MediaController } from "../media/media.controller";
import { PlaylistsController } from "../playlists/playlists.controller";
import { ClocksController } from "../clocks/clocks.controller";
import { ShowsController } from "../shows/shows.controller";
import { StreamerKeysController } from "../streamer-keys/streamer-keys.controller";
import { UsersController } from "../users/users.controller";

/**
 * RBAC wiring guard (ADR D18). @Roles metadata is DEAD unless RolesGuard is
 * actually applied — the review found four controllers shipping @Roles("admin")
 * with no guard, letting streamers mutate. This spec pins the wiring itself so
 * a controller can never again carry role metadata that nothing reads.
 */
const GUARDED = [
  ChannelsController,
  CdnController,
  MediaController,
  PlaylistsController,
  ClocksController,
  ShowsController,
  StreamerKeysController,
  UsersController,
];

describe("RolesGuard wiring (D18: streamer read-only everywhere)", () => {
  for (const controller of GUARDED) {
    it(`${controller.name} applies RolesGuard via @UseGuards`, () => {
      const guards: unknown[] = Reflect.getMetadata("__guards__", controller) ?? [];
      expect(
        guards.some((g) => g === RolesGuard || (g as { name?: string })?.name === "RolesGuard"),
        `${controller.name} must have @UseGuards(RolesGuard) at class level`,
      ).toBe(true);
    });
  }
});
