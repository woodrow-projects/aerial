import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from "@nestjs/common";
import {
  createPlaylistSchema,
  updatePlaylistSchema,
  type CreatePlaylistInput,
  type UpdatePlaylistInput,
} from "@aerial/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/roles";
import { PlaylistsService } from "./playlists.service";
import { setPlaylistTracksSchema, type SetPlaylistTracksInput } from "./playlists.schema";

/**
 * Playlist CRUD + track membership (plan Phase A). Reads are open to any signed-in
 * operator; mutations are admin-only (@Roles). Validation is via the shared zod
 * schemas through ZodValidationPipe (single source of truth in @aerial/shared).
 */
@Controller("api/playlists")
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Get()
  list() {
    return this.playlists.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.playlists.get(id);
  }

  @Post()
  @Roles("admin")
  create(@Body(new ZodValidationPipe(createPlaylistSchema)) body: CreatePlaylistInput) {
    return this.playlists.create(body);
  }

  @Patch(":id")
  @Roles("admin")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePlaylistSchema)) body: UpdatePlaylistInput,
  ) {
    return this.playlists.update(id, body);
  }

  @Put(":id/tracks")
  @Roles("admin")
  setTracks(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setPlaylistTracksSchema)) body: SetPlaylistTracksInput,
  ) {
    return this.playlists.setTracks(id, body.trackIds);
  }

  @Delete(":id")
  @Roles("admin")
  @HttpCode(204)
  remove(@Param("id") id: string) {
    return this.playlists.remove(id);
  }
}
