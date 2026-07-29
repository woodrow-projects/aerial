import { Injectable, Logger } from "@nestjs/common";
import * as path from "node:path";
import type { PlaylistOrder } from "@aerial/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ScheduleService, type Resolution } from "../shows/schedule.service";
import { parsePlaylistOrder } from "../prisma/db-columns";
import { env } from "../config/env";
import {
  buildAnnotateUri,
  pickTrack,
  resolveSlot,
  type PlaylistTrackRef,
  type RecentPlay,
  type Rng,
  type SlotSpec,
} from "./selection";

/** One decision log row surfaced to the "why this track" view (GET .../playlog). */
export interface PlayLogDto {
  id: string;
  at: string; // ISO
  channelId: string;
  trackId: string | null;
  playlistId: string | null;
  clockId: string | null;
  slotPosition: number | null;
  showId: string | null;
  reason: string;
  uri: string;
}

/** How many recent PlayLog rows to load for a playlist's dedup/sequential lookback.
 *  At radio cadence (~3-min tracks) this dwarfs any realistic dedup window, so the
 *  in-memory window filter in selection.ts sees every relevant play. */
const RECENT_LOOKBACK = 500;

/** Default / clamp bounds for the playlog read limit. */
const PLAYLOG_DEFAULT_LIMIT = 50;
const PLAYLOG_MAX_LIMIT = 200;

interface SlotWithPlaylist extends SlotSpec {
  playlist: { id: string; name: string; order: string; dedupWindowMin: number };
}

/**
 * The control-plane-owned deterministic Auto-DJ queue (ADR D17, plan §"Playout
 * engine"). Liquidsoap's `request.dynamic` calls POST /internal/next-track, which
 * delegates to `next(slug)`; the engine just plays what it's told.
 *
 * `next` resolves the active clock for (channel, now), advances that clock's slot
 * pointer over the expanded sequence, picks a track from the slot's playlist honoring
 * its order + dedup, returns a Liquidsoap annotate URI, and — in ONE transaction —
 * writes the decision to PlayLog and advances ClockState. It NEVER throws: any failure
 * is logged and returns null so the engine falls to its `mksafe` silence net (the
 * audio path must not depend on this service succeeding).
 */
@Injectable()
export class NextTrackService {
  private readonly logger = new Logger(NextTrackService.name);

  /** Seams overridable in tests: the clock and the RNG (both deterministic when set). */
  now: () => Date = () => new Date();
  rng: Rng = Math.random;

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
  ) {}

  async next(slug: string): Promise<string | null> {
    try {
      const at = this.now();

      // 1. Channel (missing/inactive -> nothing to play).
      const channel = await this.prisma.channel.findUnique({ where: { slug } });
      if (!channel || !channel.isActive) return null;

      // Resolve the active clock. scheduled -> the show's clock; live or default ->
      // the channel's defaultClock (the LOCKED never-silent rule: an absent live
      // streamer falls through to Auto-DJ). No clock anywhere -> null.
      const resolution = await this.schedule.resolve(channel.id, at);
      const clockId = this.clockIdFor(resolution, channel.defaultClockId);
      if (!clockId) return null;
      const show = "show" in resolution ? resolution.show : null;

      // 2. Load the clock's ordered slots (with their playlist config).
      const clock = await this.prisma.clock.findUnique({
        where: { id: clockId },
        include: {
          slots: {
            orderBy: { position: "asc" },
            include: {
              playlist: { select: { id: true, name: true, order: true, dedupWindowMin: true } },
            },
          },
        },
      });
      if (!clock || clock.slots.length === 0) return null;
      const slots = clock.slots as unknown as SlotWithPlaylist[];

      // ClockState pointer: reset to 0 when the active clock changed (plan step 2).
      const state = await this.prisma.clockState.findUnique({ where: { channelId: channel.id } });
      const pointer = state && state.clockId === clockId ? state.position : 0;

      const resolved = resolveSlot(slots, pointer);
      if (!resolved) return null;
      const slot = slots.find((s) => s.position === resolved.slot.position)!;
      const playlist = slot.playlist;
      const order = parsePlaylistOrder(playlist.order);

      // 3. Pick a track from the slot's playlist honoring its order + dedup.
      const members = await this.prisma.playlistTrack.findMany({
        where: { playlistId: playlist.id },
        orderBy: { position: "asc" },
        include: {
          track: {
            select: {
              id: true,
              fileName: true,
              title: true,
              artist: true,
              cueIn: true,
              cueOut: true,
              fadeIn: true,
              fadeOut: true,
              amplifyDb: true,
            },
          },
        },
      });
      if (members.length === 0) return null;

      const recent = await this.prisma.playLog.findMany({
        where: { channelId: channel.id, playlistId: playlist.id },
        orderBy: { at: "desc" },
        take: RECENT_LOOKBACK,
        select: { trackId: true, at: true },
      });

      const trackRefs: PlaylistTrackRef[] = members.map((m) => ({ trackId: m.trackId, position: m.position }));
      const recentPlays: RecentPlay[] = recent
        .filter((r): r is { trackId: string; at: Date } => r.trackId != null)
        .map((r) => ({ trackId: r.trackId, at: r.at }));

      const trackId = pickTrack({
        order,
        tracks: trackRefs,
        recent: recentPlays,
        dedupWindowMin: playlist.dedupWindowMin,
        now: at,
        rng: this.rng,
      });
      if (!trackId) return null;
      const chosen = members.find((m) => m.trackId === trackId)!.track;

      // 4. Build the annotate URI (absolute path under the media volume).
      const uri = buildAnnotateUri(chosen, path.join(env.engine.mediaRoot, chosen.fileName));

      // 5. Log the decision AND advance the pointer in ONE transaction (plan step 5).
      const reason = this.reasonLine(resolution, clock.name, slot.position, playlist.name, order, playlist.dedupWindowMin);
      await this.prisma.$transaction(async (tx) => {
        await tx.playLog.create({
          data: {
            channelId: channel.id,
            trackId,
            playlistId: playlist.id,
            clockId,
            slotPosition: slot.position,
            showId: show?.id ?? null,
            reason,
            uri,
          },
        });
        await tx.clockState.upsert({
          where: { channelId: channel.id },
          create: { channelId: channel.id, clockId, position: resolved.nextPosition },
          update: { clockId, position: resolved.nextPosition },
        });
      });

      return uri;
    } catch (err) {
      // 6. Fail-soft: log + null. The engine's mksafe silence is the safety net.
      this.logger.error(`next-track for "${slug}" failed: ${String(err)}`);
      return null;
    }
  }

  /** Newest-first decision log for a channel (GET /api/channels/:channelId/playlog). */
  async playlog(channelId: string, limit?: string): Promise<PlayLogDto[]> {
    const take = this.clampLimit(limit);
    const rows = await this.prisma.playLog.findMany({
      where: { channelId },
      orderBy: { at: "desc" },
      take,
    });
    return rows.map((r) => this.toPlayLogDto(r));
  }

  // ── helpers ────────────────────────────────────────────────────────────────────

  /**
   * The LOCKED resolution -> active-clock rule. `scheduled` plays the show's own clock;
   * `live` (streamer absent) and `default` (unscheduled) both fall to the channel's
   * defaultClock so the channel is never silent. `null` => nothing playable.
   */
  private clockIdFor(resolution: Resolution, defaultClockId: string | null): string | null {
    if (resolution.kind === "scheduled") return resolution.clockId;
    return defaultClockId ?? null;
  }

  private reasonLine(
    resolution: Resolution,
    clockName: string,
    slotPosition: number,
    playlistName: string,
    order: PlaylistOrder,
    dedupWindowMin: number,
  ): string {
    const orderDetail = order === "shuffle" ? `shuffle, dedup ${dedupWindowMin}m` : order;
    let prefix: string;
    switch (resolution.kind) {
      case "scheduled":
        prefix = `show "${resolution.show.title}" -> clock "${clockName}"`;
        break;
      case "live":
        prefix = `live show "${resolution.show.title}" (streamer absent) -> default clock "${clockName}"`;
        break;
      case "default":
        prefix = `unscheduled -> default clock "${clockName}"`;
        break;
    }
    return `${prefix} slot ${slotPosition} -> playlist "${playlistName}" (${orderDetail})`;
  }

  private clampLimit(limit?: string): number {
    const n = Number(limit);
    if (!Number.isFinite(n)) return PLAYLOG_DEFAULT_LIMIT;
    return Math.min(PLAYLOG_MAX_LIMIT, Math.max(1, Math.floor(n)));
  }

  private toPlayLogDto(r: {
    id: string;
    at: Date;
    channelId: string;
    trackId: string | null;
    playlistId: string | null;
    clockId: string | null;
    slotPosition: number | null;
    showId: string | null;
    reason: string;
    uri: string;
  }): PlayLogDto {
    return {
      id: r.id,
      at: r.at.toISOString(),
      channelId: r.channelId,
      trackId: r.trackId,
      playlistId: r.playlistId,
      clockId: r.clockId,
      slotPosition: r.slotPosition,
      showId: r.showId,
      reason: r.reason,
      uri: r.uri,
    };
  }
}
