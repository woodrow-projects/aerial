import { Injectable, NotFoundException } from "@nestjs/common";
import type { Show } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parseDaysOfWeek } from "../prisma/db-columns";

/**
 * The resolution of "what is on air" for a (channel, instant) — the pinned
 * cross-module contract consumed by the Auto-DJ queue (NextTrackService) and the
 * schedule-aware streamer auth (StreamerAuthService).
 *
 * - `live`      — a live Show is active; the owning streamer's source (if connected)
 *                 takes the channel. The resolver does NOT itself substitute the
 *                 defaultClock — callers apply the locked never-silent rule (an
 *                 absent streamer falls through to Auto-DJ's defaultClock).
 * - `scheduled` — a scheduled Show is active → run its Clock (an Auto-DJ program).
 * - `default`   — no Show is active → the channel's defaultClock fills the gap
 *                 (`clockId` null when the channel has none: silence-safe fallback).
 */
export type Resolution =
  | { kind: "live"; show: Show; ownerId: string }
  | { kind: "scheduled"; show: Show; clockId: string }
  | { kind: "default"; clockId: string | null };

/** Flattened, JSON-friendly view of a Resolution for the SPA now/next endpoint. */
export interface ResolutionSummary {
  kind: "live" | "scheduled" | "default";
  showId: string | null;
  showTitle: string | null;
  clockId: string | null; // scheduled/default
  ownerId: string | null; // live
}

/** The next scheduling boundary (a show start or end) after the queried instant. */
export interface NextTransition {
  at: string; // ISO instant of the transition
  boundary: "start" | "end"; // the show starts, or ends
  showId: string;
  showTitle: string;
  resolution: ResolutionSummary; // what is in effect immediately after `at`
}

/** Response shape of `GET /api/channels/:channelId/schedule`. */
export interface ScheduleNowNext {
  at: string; // ISO of the queried instant
  now: ResolutionSummary;
  next: NextTransition | null; // null when nothing changes within the next 24h
}

/** A single concrete airing of a show: a half-open instant window [start, end). */
interface Occurrence {
  start: Date;
  end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "HH:MM" → { h, m }. The column is db-columns-validated, so parsing is total. */
function hm(value: string): { h: number; m: number } {
  const [h, m] = value.split(":").map(Number);
  return { h, m };
}

/** Comparable server-local calendar-day key (YYYYMMDD) — TZ-stable via local getters. */
function dayKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * Schedule resolution over the Show table (plan §Scheduling & resolution), in
 * server-local time (per-install TZ). Every airing is anchored to its START day:
 * an overnight show (endTime <= startTime) that began YESTERDAY is what is on air
 * this morning, and the weekday + date-range gates apply to that start day, not to
 * the query instant. `resolve` and `activeLiveShowFor` are the pinned contract.
 */
@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  /** What is on air on `channelId` at instant `at`. Throws 404 if the channel is unknown. */
  async resolve(channelId: string, at: Date): Promise<Resolution> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { defaultClockId: true },
    });
    if (!channel) throw new NotFoundException("channel not found");
    const shows = await this.prisma.show.findMany({ where: { channelId } });
    return this.resolveFrom(channel.defaultClockId, shows, at);
  }

  /**
   * The live show owned by `userId` on `channelId` that is active at ANY instant in
   * the grace window [at - graceMin, at + graceMin] — grace covers early connects
   * (before start) and overruns (past end). Highest-precedence match wins; null if
   * none. Used by the schedule-aware harbor auth (ADR D18).
   */
  async activeLiveShowFor(
    channelId: string,
    userId: string,
    at: Date,
    graceMin: number,
  ): Promise<Show | null> {
    const g0 = new Date(at.getTime() - graceMin * 60_000);
    const g1 = new Date(at.getTime() + graceMin * 60_000);
    const shows = await this.prisma.show.findMany({
      where: { channelId, type: "live", ownerId: userId },
    });
    const matches = shows.filter((s) => this.overlapsWindow(s, g0, g1, at));
    return this.pickWinner(matches);
  }

  /** now/next summary for the SPA schedule view (`GET .../schedule`). */
  async nowNext(channelId: string, at: Date): Promise<ScheduleNowNext> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { defaultClockId: true },
    });
    if (!channel) throw new NotFoundException("channel not found");
    const shows = await this.prisma.show.findMany({ where: { channelId } });

    const now = this.summarize(this.resolveFrom(channel.defaultClockId, shows, at));
    const next = this.computeNext(channel.defaultClockId, shows, at);
    return { at: at.toISOString(), now, next };
  }

  // ── internals ─────────────────────────────────────────────────────────────────

  /** Pure resolution from already-loaded shows + the channel's defaultClock. */
  private resolveFrom(defaultClockId: string | null, shows: Show[], at: Date): Resolution {
    const active = shows.filter((s) => this.isActiveAt(s, at));
    const winner = this.pickWinner(active);
    if (!winner) return { kind: "default", clockId: defaultClockId ?? null };
    if (winner.type === "live") {
      return { kind: "live", show: winner, ownerId: winner.ownerId as string };
    }
    return { kind: "scheduled", show: winner, clockId: winner.clockId as string };
  }

  /** Precedence: higher priority wins; ties broken by most-recently created. */
  private pickWinner(shows: Show[]): Show | null {
    if (shows.length === 0) return null;
    return [...shows].sort((a, b) =>
      b.priority !== a.priority ? b.priority - a.priority : b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
  }

  /** Is `at` inside any airing of `show`? Considers start days {yesterday, today}. */
  private isActiveAt(show: Show, at: Date): boolean {
    const t = at.getTime();
    return this.occurrences(show, at, 1, 0).some((o) => o.start.getTime() <= t && t < o.end.getTime());
  }

  /** Does any airing of `show` overlap the closed grace window [g0, g1]? */
  private overlapsWindow(show: Show, g0: Date, g1: Date, center: Date): boolean {
    // fwd=1 catches a tomorrow-morning start pulled into range when `center` is near midnight.
    return this.occurrences(show, center, 1, 1).some(
      (o) => o.start.getTime() <= g1.getTime() && o.end.getTime() > g0.getTime(),
    );
  }

  /**
   * Concrete airings of `show` whose START day sits within [ref-back, ref+fwd] days
   * of `ref` (server-local), that pass the weekday and date-range gates. Overnight
   * shows (end <= start, inclusive: end==start is a 24h airing) run into the next
   * calendar day; local Date constructors normalize month/year rollover and respect
   * DST. The weekday + date-range checks are applied to the START day only.
   */
  private occurrences(show: Show, ref: Date, backDays: number, fwdDays: number): Occurrence[] {
    const days = parseDaysOfWeek(show.daysOfWeek);
    const s = hm(show.startTime);
    const e = hm(show.endTime);
    const overnight = e.h * 60 + e.m <= s.h * 60 + s.m;
    const dsKey = show.dateStart ? dayKey(show.dateStart) : null;
    const deKey = show.dateEnd ? dayKey(show.dateEnd) : null;

    const out: Occurrence[] = [];
    for (let off = -backDays; off <= fwdDays; off++) {
      const sd = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + off);
      if (!days.includes(sd.getDay())) continue; // weekday gate on the START day
      const k = dayKey(sd);
      if (dsKey !== null && k < dsKey) continue; // date-range gate on the START day
      if (deKey !== null && k > deKey) continue;

      const start = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate(), s.h, s.m);
      const end = overnight
        ? new Date(sd.getFullYear(), sd.getMonth(), sd.getDate() + 1, e.h, e.m)
        : new Date(sd.getFullYear(), sd.getMonth(), sd.getDate(), e.h, e.m);
      out.push({ start, end });
    }
    return out;
  }

  /** The earliest show boundary (start or end) strictly after `at`, within 24h. */
  private computeNext(defaultClockId: string | null, shows: Show[], at: Date): NextTransition | null {
    const t = at.getTime();
    const horizon = t + DAY_MS;
    let best: { at: Date; boundary: "start" | "end"; show: Show } | null = null;

    for (const show of shows) {
      // Start days from yesterday..+2 cover every boundary landing within (at, at+24h].
      for (const o of this.occurrences(show, at, 1, 2)) {
        for (const [inst, boundary] of [
          [o.start, "start"] as const,
          [o.end, "end"] as const,
        ]) {
          const ms = inst.getTime();
          if (ms > t && ms <= horizon && (!best || ms < best.at.getTime())) {
            best = { at: inst, boundary, show };
          }
        }
      }
    }

    if (!best) return null;
    const resolution = this.summarize(this.resolveFrom(defaultClockId, shows, best.at));
    return {
      at: best.at.toISOString(),
      boundary: best.boundary,
      showId: best.show.id,
      showTitle: best.show.title,
      resolution,
    };
  }

  private summarize(r: Resolution): ResolutionSummary {
    switch (r.kind) {
      case "live":
        return { kind: "live", showId: r.show.id, showTitle: r.show.title, clockId: null, ownerId: r.ownerId };
      case "scheduled":
        return { kind: "scheduled", showId: r.show.id, showTitle: r.show.title, clockId: r.clockId, ownerId: null };
      case "default":
        return { kind: "default", showId: null, showTitle: null, clockId: r.clockId, ownerId: null };
    }
  }
}
