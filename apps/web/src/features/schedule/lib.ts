/**
 * Pure date/geometry helpers for the weekly schedule calendar — framework-free so
 * the tricky bits (overnight-wrap segments, block positioning percentages, day
 * toggles) are unit-testable headless (see lib.spec.ts). The React grid only
 * renders what these return. Everything works in server-local wall-clock terms:
 * "HH:MM" strings and minutes-since-midnight, 0=Sunday..6=Saturday — matching the
 * control-plane scheduler (apps/control-plane/src/shows/schedule.service.ts).
 */
import type { ShowDto } from "./types";

/** Short day labels, index = day-of-week (0=Sunday..6=Saturday). */
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Minutes in a day — the denominator for every vertical percentage. */
export const MINUTES_PER_DAY = 24 * 60; // 1440

/** The 24 hour rows the grid draws down its gutter. */
export const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** "HH:MM" → minutes since midnight (0..1439). Input is HH:MM-validated upstream. */
export function hmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** minutes → zero-padded "HH:MM", wrapping a full day (1440 → "00:00"). */
export function minutesToHm(min: number): string {
  const wrapped = ((min % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * A show wraps past midnight when its end is at or before its start — identical to
 * the backend's `end <= start` rule (end == start is a full 24h airing).
 */
export function isOvernight(startTime: string, endTime: string): boolean {
  return hmToMinutes(endTime) <= hmToMinutes(startTime);
}

/** Vertical placement of a [startMin, endMin) span in a 24h column, as percentages. */
export function blockPosition(startMin: number, endMin: number): { topPct: number; heightPct: number } {
  return {
    topPct: (startMin / MINUTES_PER_DAY) * 100,
    heightPct: ((endMin - startMin) / MINUTES_PER_DAY) * 100,
  };
}

/** One drawable block on the week grid: a positioned span within a single day column. */
export interface ShowSegment {
  show: ShowDto;
  day: number; // 0..6 grid column this segment renders in
  startMin: number; // minutes from midnight on `day`
  endMin: number; // minutes from midnight on `day` (<= MINUTES_PER_DAY)
  topPct: number;
  heightPct: number;
  /** True when this is the wrapped tail of an overnight show (starts at 00:00). */
  isContinuation: boolean;
  /** True when this segment runs to midnight and continues onto the next day. */
  continuesNext: boolean;
  /** Stable key for React lists. */
  key: string;
}

function segment(
  show: ShowDto,
  day: number,
  startMin: number,
  endMin: number,
  isContinuation: boolean,
  continuesNext: boolean,
): ShowSegment {
  return {
    show,
    day,
    startMin,
    endMin,
    ...blockPosition(startMin, endMin),
    isContinuation,
    continuesNext,
    key: `${show.id}:${day}:${startMin}`,
  };
}

/**
 * Expand one show into its drawable grid segments. A same-day show yields one
 * segment per aired day. An overnight show yields two per aired day: a head from
 * its start down to midnight, and a wrapped tail on the NEXT day (Saturday → Sunday)
 * from midnight to its end. A tail that would be zero-length (end exactly at
 * midnight) is dropped, and the head is then flagged as not continuing.
 */
export function showSegments(show: ShowDto): ShowSegment[] {
  const startMin = hmToMinutes(show.startTime);
  const endMin = hmToMinutes(show.endTime);
  const overnight = isOvernight(show.startTime, show.endTime);
  const out: ShowSegment[] = [];

  for (const day of show.daysOfWeek) {
    if (!overnight) {
      out.push(segment(show, day, startMin, endMin, false, false));
      continue;
    }
    const hasTail = endMin > 0;
    out.push(segment(show, day, startMin, MINUTES_PER_DAY, false, hasTail));
    if (hasTail) {
      out.push(segment(show, (day + 1) % 7, 0, endMin, true, false));
    }
  }
  return out;
}

/** Every show's segments, flattened into one positioned list for the grid. */
export function allSegments(shows: ShowDto[]): ShowSegment[] {
  return shows.flatMap(showSegments);
}

/** Toggle a day in a days-of-week set, keeping it unique and sorted ascending. */
export function toggleDay(days: number[], day: number): number[] {
  return days.includes(day)
    ? days.filter((d) => d !== day)
    : [...days, day].sort((a, b) => a - b);
}

/** Human summary of a days-of-week set: "Every day" or "Mon, Wed, Fri". */
export function describeDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  return [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(", ");
}
