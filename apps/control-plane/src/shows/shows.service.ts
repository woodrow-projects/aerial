import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Show } from "@prisma/client";
import type { CreateShowInput, ShowType } from "@aerial/shared";
import { PrismaService } from "../prisma/prisma.service";
import { parseDaysOfWeek, parseShowType, serializeDaysOfWeek } from "../prisma/db-columns";
import type { UpdateShowInput } from "./shows.schema";

/** A Show as returned by the API (TEXT-enum + JSON columns decoded for the SPA). */
export interface ShowDto {
  id: string;
  channelId: string;
  type: ShowType;
  title: string;
  clockId: string | null; // scheduled shows
  ownerId: string | null; // live shows
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  daysOfWeek: number[]; // 0=Sunday..6=Saturday
  dateStart: string | null; // ISO
  dateEnd: string | null; // ISO
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Per-channel Show CRUD (plan Phase C/D). A Show is a channel-scoped programming
 * block; `channelId` comes from the route. The discriminated create body
 * (@aerial/shared `createShowSchema`) is validated at the controller; this service
 * owns the cross-entity checks the schema can't: the channel must exist (404),
 * dateStart <= dateEnd (400), a scheduled show's clock must exist and a live show's
 * owning User must exist (400). Reference existence for the owner is a service-layer
 * check because Show.ownerId is a scalar (no FK — better-auth owns the User model).
 */
@Injectable()
export class ShowsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(channelId: string): Promise<ShowDto[]> {
    await this.assertChannel(channelId);
    const rows = await this.prisma.show.findMany({
      where: { channelId },
      orderBy: [{ startTime: "asc" }, { priority: "desc" }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(channelId: string, id: string): Promise<ShowDto> {
    return this.toDto(await this.findInChannel(channelId, id));
  }

  async create(channelId: string, input: CreateShowInput): Promise<ShowDto> {
    await this.assertChannel(channelId);
    this.assertDateRange(input.dateStart, input.dateEnd);
    if (input.type === "scheduled") await this.assertClock(input.clockId);
    else await this.assertOwner(input.ownerId);

    const row = await this.prisma.show.create({
      data: {
        channelId,
        type: input.type,
        title: input.title,
        clockId: input.type === "scheduled" ? input.clockId : null,
        ownerId: input.type === "live" ? input.ownerId : null,
        startTime: input.startTime,
        endTime: input.endTime,
        daysOfWeek: serializeDaysOfWeek(input.daysOfWeek),
        dateStart: input.dateStart ?? null,
        dateEnd: input.dateEnd ?? null,
        priority: input.priority,
      },
    });
    return this.toDto(row);
  }

  async update(channelId: string, id: string, input: UpdateShowInput): Promise<ShowDto> {
    const existing = await this.findInChannel(channelId, id);
    const type = parseShowType(existing.type);

    // `type` is immutable, so a clock ref belongs only to a scheduled show and an
    // owner ref only to a live show; validate the reference exists too.
    if (input.clockId !== undefined) {
      if (type !== "scheduled") throw new BadRequestException("clockId can only be set on a scheduled show");
      await this.assertClock(input.clockId);
    }
    if (input.ownerId !== undefined) {
      if (type !== "live") throw new BadRequestException("ownerId can only be set on a live show");
      await this.assertOwner(input.ownerId);
    }

    // Validate the effective (merged) date range — a new bound vs the persisted one.
    const dateStart = input.dateStart !== undefined ? input.dateStart : existing.dateStart;
    const dateEnd = input.dateEnd !== undefined ? input.dateEnd : existing.dateEnd;
    this.assertDateRange(dateStart, dateEnd);

    const row = await this.prisma.show.update({
      where: { id },
      data: {
        title: input.title ?? undefined,
        startTime: input.startTime ?? undefined,
        endTime: input.endTime ?? undefined,
        daysOfWeek: input.daysOfWeek ? serializeDaysOfWeek(input.daysOfWeek) : undefined,
        // undefined = leave unchanged; null = clear the bound.
        dateStart: input.dateStart !== undefined ? input.dateStart : undefined,
        dateEnd: input.dateEnd !== undefined ? input.dateEnd : undefined,
        priority: input.priority ?? undefined,
        clockId: input.clockId ?? undefined,
        ownerId: input.ownerId ?? undefined,
      },
    });
    return this.toDto(row);
  }

  async remove(channelId: string, id: string): Promise<void> {
    await this.findInChannel(channelId, id);
    await this.prisma.show.delete({ where: { id } });
  }

  // ── internals ─────────────────────────────────────────────────────────────────

  private async assertChannel(channelId: string): Promise<void> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId }, select: { id: true } });
    if (!channel) throw new NotFoundException("channel not found");
  }

  /** Loads a show and enforces it belongs to the route channel (404 otherwise). */
  private async findInChannel(channelId: string, id: string): Promise<Show> {
    const row = await this.prisma.show.findUnique({ where: { id } });
    if (!row || row.channelId !== channelId) throw new NotFoundException("show not found");
    return row;
  }

  private assertDateRange(dateStart?: Date | null, dateEnd?: Date | null): void {
    if (dateStart && dateEnd && dateStart.getTime() > dateEnd.getTime()) {
      throw new BadRequestException("dateStart must be on or before dateEnd");
    }
  }

  private async assertClock(clockId: string): Promise<void> {
    const clock = await this.prisma.clock.findUnique({ where: { id: clockId }, select: { id: true } });
    if (!clock) throw new BadRequestException(`unknown clock id: ${clockId}`);
  }

  private async assertOwner(ownerId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
    if (!user) throw new BadRequestException(`unknown owner (user) id: ${ownerId}`);
  }

  private toDto(row: Show): ShowDto {
    return {
      id: row.id,
      channelId: row.channelId,
      type: parseShowType(row.type),
      title: row.title,
      clockId: row.clockId,
      ownerId: row.ownerId,
      startTime: row.startTime,
      endTime: row.endTime,
      daysOfWeek: parseDaysOfWeek(row.daysOfWeek),
      dateStart: row.dateStart ? row.dateStart.toISOString() : null,
      dateEnd: row.dateEnd ? row.dateEnd.toISOString() : null,
      priority: row.priority,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
