import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createChannelSchema,
  updateChannelSchema,
  type CreateChannelInput,
  type UpdateChannelInput,
} from "@aerial/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles, RolesGuard } from "../auth/roles";
import { NowPlayingService } from "../nowplaying/nowplaying.service";
import { ChannelsService } from "./channels.service";
import { StreamKeysService } from "./stream-keys.service";

/**
 * Channel CRUD + stream-key management. Reads (list/get/nowplaying/listKeys) stay
 * open to any signed-in operator; all mutations — including stream-key issuance and
 * revocation — are admin-only (ADR D18: a streamer's panel is read-only), enforced
 * by RolesGuard reading the @Roles metadata below.
 */
@Controller("api/channels")
@UseGuards(RolesGuard)
export class ChannelsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly streamKeys: StreamKeysService,
    private readonly nowPlaying: NowPlayingService,
  ) {}

  @Get()
  list() {
    return this.channels.list();
  }

  @Post()
  @Roles("admin")
  create(@Body(new ZodValidationPipe(createChannelSchema)) body: CreateChannelInput) {
    return this.channels.create(body);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.channels.get(id);
  }

  @Patch(":id")
  @Roles("admin")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(updateChannelSchema)) body: UpdateChannelInput) {
    return this.channels.update(id, body);
  }

  @Delete(":id")
  @Roles("admin")
  @HttpCode(204)
  remove(@Param("id") id: string) {
    return this.channels.remove(id);
  }

  @Get(":id/nowplaying")
  async nowplaying(@Param("id") id: string) {
    const channel = await this.channels.get(id);
    return this.nowPlaying.read(channel.slug);
  }

  // ── Stream keys ──────────────────────────────────────────────────────────────
  @Post(":id/keys")
  @Roles("admin")
  @HttpCode(201)
  createKey(@Param("id") id: string) {
    return this.streamKeys.create(id);
  }

  @Get(":id/keys")
  listKeys(@Param("id") id: string) {
    return this.streamKeys.list(id);
  }

  @Delete(":id/keys/:keyId")
  @Roles("admin")
  @HttpCode(204)
  revokeKey(@Param("keyId") keyId: string) {
    return this.streamKeys.revoke(keyId);
  }
}
