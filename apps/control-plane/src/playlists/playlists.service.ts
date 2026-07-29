import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreatePlaylistInput, PlaylistOrder, UpdatePlaylistInput } from "@aerial/shared";
import { PrismaService } from "../prisma/prisma.service";
import { parsePlaylistOrder } from "../prisma/db-columns";

/** A playlist in list form: its config + how many tracks it holds. */
export interface PlaylistDto {
  id: string;
  name: string;
  order: PlaylistOrder;
  dedupWindowMin: number;
  isJingle: boolean;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One ordered member of a playlist (flattened Track fields for the SPA/editor). */
export interface PlaylistTrackDto {
  trackId: string;
  position: number;
  title: string;
  artist: string | null;
  fileName: string;
  durationSec: number;
}

/** A playlist with its ordered track membership (GET :id / after a membership replace). */
export interface PlaylistDetailDto extends PlaylistDto {
  tracks: PlaylistTrackDto[];
}

/**
 * Playlist CRUD + atomic track-membership replace (plan Phase A). Playlists are
 * install-level, reusable across channels; a playlist wired into a clock slot is
 * Restrict-protected from deletion (surfaced here as a 409 naming the clocks).
 */
@Injectable()
export class PlaylistsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<PlaylistDto[]> {
    const rows = await this.prisma.playlist.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { tracks: true } } },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<PlaylistDetailDto> {
    const row = await this.prisma.playlist.findUnique({
      where: { id },
      include: { tracks: { include: { track: true }, orderBy: { position: "asc" } } },
    });
    if (!row) throw new NotFoundException("playlist not found");
    return this.toDetailDto(row);
  }

  async create(input: CreatePlaylistInput): Promise<PlaylistDto> {
    try {
      const row = await this.prisma.playlist.create({
        data: {
          name: input.name,
          order: input.order,
          dedupWindowMin: input.dedupWindowMin,
          isJingle: input.isJingle,
        },
        include: { _count: { select: { tracks: true } } },
      });
      return this.toDto(row);
    } catch (err) {
      throw this.mapNameConflict(err, input.name);
    }
  }

  async update(id: string, input: UpdatePlaylistInput): Promise<PlaylistDto> {
    const existing = await this.prisma.playlist.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("playlist not found");
    try {
      const row = await this.prisma.playlist.update({
        where: { id },
        data: {
          name: input.name ?? undefined,
          order: input.order ?? undefined,
          dedupWindowMin: input.dedupWindowMin ?? undefined,
          isJingle: input.isJingle ?? undefined,
        },
        include: { _count: { select: { tracks: true } } },
      });
      return this.toDto(row);
    } catch (err) {
      throw this.mapNameConflict(err, input.name ?? existing.name);
    }
  }

  /**
   * Replace the playlist's ordered membership atomically. Positions follow the
   * `trackIds` array order. Validates every id exists (400 otherwise) and rejects
   * duplicates before touching the DB; the delete-all + recreate runs in one
   * interactive transaction so a mid-flight failure never leaves partial state.
   */
  async setTracks(id: string, trackIds: string[]): Promise<PlaylistDetailDto> {
    const existing = await this.prisma.playlist.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("playlist not found");

    if (new Set(trackIds).size !== trackIds.length) {
      throw new BadRequestException("trackIds must not contain duplicates");
    }

    if (trackIds.length > 0) {
      const found = await this.prisma.track.findMany({
        where: { id: { in: trackIds } },
        select: { id: true },
      });
      if (found.length !== trackIds.length) {
        const foundIds = new Set(found.map((t) => t.id));
        const missing = trackIds.filter((t) => !foundIds.has(t));
        throw new BadRequestException(`unknown track id(s): ${missing.join(", ")}`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.playlistTrack.deleteMany({ where: { playlistId: id } });
      if (trackIds.length > 0) {
        await tx.playlistTrack.createMany({
          data: trackIds.map((trackId, position) => ({ playlistId: id, trackId, position })),
        });
      }
    });

    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.playlist.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("playlist not found");

    // ClockSlot.playlist is onDelete: Restrict — check explicitly so we can name
    // the referencing clocks in the 409 (the DB FK error would not).
    const slots = await this.prisma.clockSlot.findMany({
      where: { playlistId: id },
      include: { clock: { select: { name: true } } },
    });
    if (slots.length > 0) {
      const clockNames = [...new Set(slots.map((s) => s.clock.name))];
      throw new ConflictException(
        `cannot delete playlist: it is used by clock(s): ${clockNames.join(", ")}`,
      );
    }

    await this.prisma.playlist.delete({ where: { id } });
  }

  private mapNameConflict(err: unknown, name: string): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return new ConflictException(`a playlist named "${name}" already exists`);
    }
    return err;
  }

  private toDto(row: {
    id: string;
    name: string;
    order: string;
    dedupWindowMin: number;
    isJingle: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count?: { tracks: number };
  }): PlaylistDto {
    return {
      id: row.id,
      name: row.name,
      order: parsePlaylistOrder(row.order),
      dedupWindowMin: row.dedupWindowMin,
      isJingle: row.isJingle,
      trackCount: row._count?.tracks ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetailDto(row: {
    id: string;
    name: string;
    order: string;
    dedupWindowMin: number;
    isJingle: boolean;
    createdAt: Date;
    updatedAt: Date;
    tracks: Array<{
      trackId: string;
      position: number;
      track: { title: string; artist: string | null; fileName: string; durationSec: number };
    }>;
  }): PlaylistDetailDto {
    return {
      ...this.toDto({ ...row, _count: { tracks: row.tracks.length } }),
      tracks: row.tracks.map((pt) => ({
        trackId: pt.trackId,
        position: pt.position,
        title: pt.track.title,
        artist: pt.track.artist,
        fileName: pt.track.fileName,
        durationSec: pt.track.durationSec,
      })),
    };
  }
}
