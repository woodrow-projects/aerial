import { describe, it, expect } from "vitest";
import {
  hmToMinutes,
  minutesToHm,
  isOvernight,
  blockPosition,
  showSegments,
  allSegments,
  toggleDay,
  describeDays,
  MINUTES_PER_DAY,
  DAY_LABELS,
} from "./lib";
import type { ShowDto } from "./types";

const show = (over: Partial<ShowDto>): ShowDto => ({
  id: "s1",
  channelId: "c1",
  type: "scheduled",
  title: "Show",
  clockId: "k1",
  ownerId: null,
  startTime: "10:00",
  endTime: "12:00",
  daysOfWeek: [1],
  dateStart: null,
  dateEnd: null,
  priority: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("hmToMinutes / minutesToHm", () => {
  it("parses HH:MM to minutes since midnight", () => {
    expect(hmToMinutes("00:00")).toBe(0);
    expect(hmToMinutes("10:30")).toBe(630);
    expect(hmToMinutes("23:59")).toBe(1439);
  });

  it("round-trips minutes back to zero-padded HH:MM, wrapping a full day", () => {
    expect(minutesToHm(0)).toBe("00:00");
    expect(minutesToHm(630)).toBe("10:30");
    expect(minutesToHm(1439)).toBe("23:59");
    // 1440 (midnight of the next day) wraps to 00:00.
    expect(minutesToHm(MINUTES_PER_DAY)).toBe("00:00");
  });
});

describe("isOvernight", () => {
  it("is false for a same-day window (end after start)", () => {
    expect(isOvernight("10:00", "12:00")).toBe(false);
  });

  it("is true when end is at or before start (wraps past midnight)", () => {
    expect(isOvernight("22:00", "02:00")).toBe(true);
    // end == start is a full 24h airing (matches the backend's `end <= start`).
    expect(isOvernight("06:00", "06:00")).toBe(true);
  });
});

describe("blockPosition", () => {
  it("expresses a span as top/height percentages of the 24h column", () => {
    const { topPct, heightPct } = blockPosition(600, 720); // 10:00–12:00
    expect(topPct).toBeCloseTo(41.6667, 3);
    expect(heightPct).toBeCloseTo(8.3333, 3);
  });

  it("places midnight-to-midnight as the full column", () => {
    expect(blockPosition(0, MINUTES_PER_DAY)).toEqual({ topPct: 0, heightPct: 100 });
  });
});

describe("showSegments", () => {
  it("emits one segment per aired day for a same-day show", () => {
    const segs = showSegments(show({ daysOfWeek: [1, 3], startTime: "10:00", endTime: "12:00" }));
    expect(segs).toHaveLength(2);
    expect(segs.map((s) => s.day)).toEqual([1, 3]);
    for (const s of segs) {
      expect(s.isContinuation).toBe(false);
      expect(s.continuesNext).toBe(false);
      expect(s.topPct).toBeCloseTo(41.6667, 3);
      expect(s.heightPct).toBeCloseTo(8.3333, 3);
    }
  });

  it("splits an overnight show into a head-to-midnight and a wrapped tail on the next day", () => {
    const segs = showSegments(show({ daysOfWeek: [5], startTime: "22:00", endTime: "02:00" }));
    expect(segs).toHaveLength(2);

    const [head, tail] = segs;
    // Head: Friday 22:00 → midnight.
    expect(head.day).toBe(5);
    expect(head.isContinuation).toBe(false);
    expect(head.continuesNext).toBe(true);
    expect(head.startMin).toBe(1320);
    expect(head.endMin).toBe(MINUTES_PER_DAY);
    expect(head.topPct).toBeCloseTo(91.6667, 3);
    expect(head.heightPct).toBeCloseTo(8.3333, 3);

    // Tail: Saturday 00:00 → 02:00, flagged as the continuation.
    expect(tail.day).toBe(6);
    expect(tail.isContinuation).toBe(true);
    expect(tail.continuesNext).toBe(false);
    expect(tail.startMin).toBe(0);
    expect(tail.endMin).toBe(120);
    expect(tail.topPct).toBe(0);
    expect(tail.heightPct).toBeCloseTo(8.3333, 3);
  });

  it("wraps the tail from Saturday onto Sunday (day 6 → day 0)", () => {
    const segs = showSegments(show({ daysOfWeek: [6], startTime: "23:00", endTime: "01:00" }));
    expect(segs.map((s) => s.day)).toEqual([6, 0]);
  });

  it("suppresses a zero-length tail when the show ends exactly at midnight", () => {
    const segs = showSegments(show({ daysOfWeek: [1], startTime: "22:00", endTime: "00:00" }));
    expect(segs).toHaveLength(1);
    expect(segs[0].day).toBe(1);
    expect(segs[0].continuesNext).toBe(false);
    expect(segs[0].endMin).toBe(MINUTES_PER_DAY);
  });

  it("renders a 24h airing (end == start) as a head plus a same-time tail summing to a full day", () => {
    const segs = showSegments(show({ daysOfWeek: [0], startTime: "06:00", endTime: "06:00" }));
    expect(segs).toHaveLength(2);
    expect(segs[0].day).toBe(0);
    expect(segs[1].day).toBe(1);
    const total = segs[0].heightPct + segs[1].heightPct;
    expect(total).toBeCloseTo(100, 6);
  });

  it("carries the show reference and a stable per-segment key", () => {
    const s = show({ id: "abc", daysOfWeek: [2] });
    const [seg] = showSegments(s);
    expect(seg.show).toBe(s);
    expect(seg.key).toContain("abc");
  });
});

describe("allSegments", () => {
  it("flattens every show's segments into one positioned list", () => {
    const a = show({ id: "a", daysOfWeek: [1], startTime: "10:00", endTime: "11:00" });
    const b = show({ id: "b", daysOfWeek: [5], startTime: "22:00", endTime: "02:00" });
    expect(allSegments([a, b])).toHaveLength(1 + 2);
  });
});

describe("toggleDay", () => {
  it("removes a present day and keeps the set sorted", () => {
    expect(toggleDay([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("adds an absent day in ascending order", () => {
    expect(toggleDay([1, 3], 2)).toEqual([1, 2, 3]);
    expect(toggleDay([], 5)).toEqual([5]);
  });
});

describe("describeDays", () => {
  it("collapses the full week to a single label", () => {
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
  });

  it("lists selected days by their short label in order", () => {
    expect(describeDays([1, 3, 5])).toBe("Mon, Wed, Fri");
  });

  it("exposes seven ordered day labels starting at Sunday", () => {
    expect(DAY_LABELS).toHaveLength(7);
    expect(DAY_LABELS[0]).toBe("Sun");
    expect(DAY_LABELS[6]).toBe("Sat");
  });
});
