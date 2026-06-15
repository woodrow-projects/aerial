import { Body, Controller, HttpCode, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import {
  authHookSchema,
  nowPlayingSchema,
  statusHookSchema,
  type AuthHookInput,
  type NowPlayingInput,
  type StatusHookInput,
} from "@aerial/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { InternalTokenGuard } from "../common/internal-token.guard";
import { Public } from "../auth/auth.guard";
import { StreamKeysService } from "../channels/stream-keys.service";
import { NowPlayingService } from "../nowplaying/nowplaying.service";

/**
 * Hooks called by the Liquidsoap engine over the internal network. Guarded by a
 * shared token (ADR D10). Not part of the public API surface.
 */
// @Public() exempts these hooks from the global operator AuthGuard (Liquidsoap
// carries no session cookie); the shared-token InternalTokenGuard still enforces.
@Controller("internal")
@Public()
@UseGuards(InternalTokenGuard)
export class InternalController {
  constructor(
    private readonly streamKeys: StreamKeysService,
    private readonly nowPlaying: NowPlayingService,
  ) {}

  /** Harbor source auth: 200 => accept the live feed, 401 => drop it. */
  @Post("auth")
  @HttpCode(200)
  async auth(@Body(new ZodValidationPipe(authHookSchema)) body: AuthHookInput) {
    const ok = body.user === "source" && (await this.streamKeys.verify(body.mount, body.password));
    if (!ok) throw new UnauthorizedException();
    return { allowed: true };
  }

  @Post("metadata")
  @HttpCode(204)
  metadata(@Body(new ZodValidationPipe(nowPlayingSchema)) body: NowPlayingInput) {
    this.nowPlaying.update(body.slug, body.title, body.artist);
  }

  @Post("status")
  @HttpCode(204)
  status(@Body(new ZodValidationPipe(statusHookSchema)) body: StatusHookInput) {
    this.nowPlaying.setLive(body.slug, body.live);
  }
}
