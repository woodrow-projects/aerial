import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ClockSlotInput, CreateClockInput } from "@aerial/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { UpdateClockInput } from "./clocks.schema";

/** One resolved slot of a clockwheel (playlist name flattened for the SPA editor). */
export interface ClockSlotDto {
  position: number;
  playlistId: string;
  playlistName: string;
  count: number;
}

/** A clock in list form: its identity + how many slots it holds. */
export interface ClockDto {
  id: string;
  name: string;
  slotCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A clock with its ordered slots (GET :id — the clockwheel editor reads this). */
export interface ClockDetailDto extends ClockDto {
  slots: ClockSlotDto[];
}

/**
 * Clockwheel CRUD (plan Phase B). A Clock is an ordered, repeating template of
 * slots; create/update replace the full slot array atomically (positions must be
 * contiguous from 0). Clocks are install-level and reusable across channels; a
 * clock referenced by a channel's defaultClock or a scheduled show is blocked
 * from deletion here (409 naming the referrers) — the channel FK is SetNull, so
 * this guard is explicit rather than relying on the database.
 */
@Injectable()
export class ClocksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ClockDto[]> {
    const rows = await this.prisma.clock.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { slots: true } } },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<ClockDetailDto> {
    const row = await this.prisma.clock.findUnique({
      where: { id },
      include: { slots: { include: { playlist: { select: { name: true } } }, orderBy: { position: "asc" } } },
    });
    if (!row) throw new NotFoundException("clock not found");
    return this.toDetailDto(row);
  }

  async create(input: CreateClockInput): Promise<ClockDetailDto> {
    await this.validateSlots(input.slots);

    let clockId: string;
    try {
      clockId = await this.prisma.$transaction(async (tx) => {
        const clock = await tx.clock.create({ data: { name: input.name } });
        await tx.clockSlot.createMany({ data: this.slotRows(clock.id, input.slots) });
        return clock.id;
      });
    } catch (err) {
      throw this.mapNameConflict(err, input.name);
    }
    return this.get(clockId);
  }

  /**
   * Replace name and/or the full slot array atomically. When `slots` is provided
   * it is validated (contiguous positions, all playlists exist) before opening
   * the transaction; the delete-all + recreate then runs in one interactive
   * transaction so a mid-flight failure never leaves partial state.
   */
  async update(id: string, input: UpdateClockInput): Promise<ClockDetailDto> {
    const existing = await this.prisma.clock.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("clock not found");

    if (input.slots) await this.validateSlots(input.slots);

    try {
      await this.prisma.$transaction(async (tx) => {
        if (input.name !== undefined) {
          await tx.clock.update({ where: { id }, data: { name: input.name } });
        }
        if (input.slots) {
          await tx.clockSlot.deleteMany({ where: { clockId: id } });
          await tx.clockSlot.createMany({ data: this.slotRows(id, input.slots) });
        }
      });
    } catch (err) {
      throw this.mapNameConflict(err, input.name ?? existing.name);
    }
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.clock.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("clock not found");

    // Channel.defaultClock is onDelete: SetNull and Show.clock is Restrict, so the
    // database alone would neither block a channel reference nor name any referrer.
    // Check both explicitly and surface a 409 that names them (plan Phase B).
    const [channels, shows] = await Promise.all([
      this.prisma.channel.findMany({ where: { defaultClockId: id }, select: { name: true } }),
      this.prisma.show.findMany({ where: { clockId: id }, select: { title: true } }),
    ]);
    if (channels.length > 0 || shows.length > 0) {
      const refs: string[] = [];
      if (channels.length > 0) {
        refs.push(`channel default-clock: ${[...new Set(channels.map((c) => c.name))].join(", ")}`);
      }
      if (shows.length > 0) {
        refs.push(`scheduled show(s): ${[...new Set(shows.map((s) => s.title))].join(", ")}`);
      }
      throw new ConflictException(`cannot delete clock: it is referenced by ${refs.join("; ")}`);
    }

    await this.prisma.clock.delete({ where: { id } });
  }

  /**
   * Positions must form the contiguous set {0..n-1} (no gaps, no duplicates), and
   * every referenced playlist must exist. Repeated playlists across slots are
   * allowed (e.g. Currents at positions 0, 3, 6); existence is looked up once per
   * distinct id. Throws 400 on either violation, before any write.
   */
  private async validateSlots(slots: ClockSlotInput[]): Promise<void> {
    const positions = slots.map((s) => s.position).sort((a, b) => a - b);
    const contiguous = positions.every((p, i) => p === i);
    if (!contiguous) {
      throw new BadRequestException("slot positions must be contiguous starting at 0 with no gaps or duplicates");
    }

    const distinct = [...new Set(slots.map((s) => s.playlistId))];
    const found = await this.prisma.playlist.findMany({ where: { id: { in: distinct } }, select: { id: true } });
    if (found.length !== distinct.length) {
      const foundIds = new Set(found.map((p) => p.id));
      const missing = distinct.filter((p) => !foundIds.has(p));
      throw new BadRequestException(`unknown playlist id(s): ${missing.join(", ")}`);
    }
  }

  private slotRows(clockId: string, slots: ClockSlotInput[]) {
    return slots.map((s) => ({ clockId, position: s.position, playlistId: s.playlistId, count: s.count }));
  }

  private mapNameConflict(err: unknown, name: string): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return new ConflictException(`a clock named "${name}" already exists`);
    }
    return err;
  }

  private toDto(row: {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    _count?: { slots: number };
  }): ClockDto {
    return {
      id: row.id,
      name: row.name,
      slotCount: row._count?.slots ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetailDto(row: {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    slots: Array<{ position: number; playlistId: string; count: number; playlist: { name: string } }>;
  }): ClockDetailDto {
    return {
      ...this.toDto({ ...row, _count: { slots: row.slots.length } }),
      slots: row.slots.map((s) => ({
        position: s.position,
        playlistId: s.playlistId,
        playlistName: s.playlist.name,
        count: s.count,
      })),
    };
  }
}
