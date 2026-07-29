import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  authHookSchema,
  nextTrackHookSchema,
  nowPlayingSchema,
  statusHookSchema,
  type AuthHookInput,
  type NextTrackHookInput,
  type NowPlayingInput,
  type StatusHookInput,
} from "@aerial/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { InternalTokenGuard } from "../common/internal-token.guard";
import { Public } from "../auth/auth.guard";
import { NowPlayingService } from "../nowplaying/nowplaying.service";
import { SessionsService } from "../sessions/sessions.service";
import { StreamerAuthService } from "../streamer-keys/streamer-auth.service";
import { NextTrackService } from "../autodj/next-track.service";

/** Structural slice of FastifyReply (fastify is not a direct dependency). */
interface StatusReply {
  status(code: number): unknown;
}

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
    private readonly streamerAuth: StreamerAuthService,
    private readonly nowPlaying: NowPlayingService,
    private readonly sessions: SessionsService,
    private readonly nextTrackService: NextTrackService,
  ) {}

  /**
   * Harbor source auth: 200 => accept the live feed, 401 => drop it.
   * Schedule-aware (ADR D18): per-user streamer keys gated by the live-show
   * schedule (unless the channel opts out), with the legacy per-channel key
   * as an advisory fallback. Identity comes from the key, never the username.
   */
  @Post("auth")
  @HttpCode(200)
  async auth(@Body(new ZodValidationPipe(authHookSchema)) body: AuthHookInput) {
    const result =
      body.user === "source"
        ? await this.streamerAuth.verify(body.mount, body.password, body.address)
        : { ok: false as const };
    if (!result.ok) throw new UnauthorizedException();
    return { allowed: true };
  }

  @Post("metadata")
  @HttpCode(204)
  metadata(@Body(new ZodValidationPipe(nowPlayingSchema)) body: NowPlayingInput) {
    this.nowPlaying.update(body.slug, body.title, body.artist);
  }

  @Post("status")
  @HttpCode(204)
  async status(@Body(new ZodValidationPipe(statusHookSchema)) body: StatusHookInput) {
    this.nowPlaying.setLive(body.slug, body.live);
    // Per-stream session log (ADR D10). Best-effort: SessionsService swallows its
    // own persistence errors, so this await never throws and the hook still 204s.
    if (body.live) {
      // Streamer identity was established seconds ago by the auth hook (mount = "/<slug>").
      const accepted = this.streamerAuth.lastAccepted(`/${body.slug}`);
      await this.sessions.open(body.slug, body.address ?? null, accepted?.userId ?? null);
    } else {
      await this.sessions.close(body.slug);
    }
  }

  /**
   * Auto-DJ pull (ADR D17): the engine's request.dynamic asks for the next
   * track. 200 + annotate-URI body, or 204 when nothing is playable (the
   * engine then falls to its silence fallback).
   */
  @Post("next-track")
  @Header("content-type", "text/plain; charset=utf-8")
  async nextTrack(
    @Body(new ZodValidationPipe(nextTrackHookSchema)) body: NextTrackHookInput,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<string> {
    const uri = await this.nextTrackService.next(body.slug);
    if (uri === null) {
      reply.status(204);
      return "";
    }
    reply.status(200);
    return uri;
  }
}
