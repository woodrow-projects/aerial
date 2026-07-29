import { NotFoundException } from "@nestjs/common";
import type { Show } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleService } from "./schedule.service";

/**
 * ScheduleService — the pinned resolution contract (plan §Scheduling & resolution,
 * with the locked never-silent rule). Prisma is mocked. All Dates are built with
 * LOCAL constructors (`new Date(y, m, d, hh, mm)`) so the tests are deterministic
 * regardless of the runner's timezone — the resolver works in server-local time
 * (per-install TZ) and every occurrence is anchored to its START day.
 */

// A fully-formed Show row (Prisma shape) with scheduled defaults; override per test.
function show(overrides: Partial<Show> = {}): Show {
  return {
    id: "s1",
    channelId: "ch1",
    type: "scheduled",
    title: "A Show",
    clockId: "clk1",
    ownerId: null,
    startTime: "10:00",
    endTime: "12:00",
    daysOfWeek: "[0,1,2,3,4,5,6]",
    dateStart: null,
    dateEnd: null,
    priority: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Show;
}

// JSON daysOfWeek column for a set of weekday numbers.
const dow = (...days: number[]) => JSON.stringify(days);

function mockPrisma(opts: { channel?: { defaultClockId: string | null } | null; shows?: Show[] } = {}) {
  const m = {
    channel: {
      findUnique: vi.fn().mockResolvedValue(
        opts.channel === undefined ? { defaultClockId: null } : opts.channel,
      ),
    },
    show: { findMany: vi.fn().mockResolvedValue(opts.shows ?? []) },
  };
  return m as never;
}
const showFindMany = (p: ReturnType<typeof mockPrisma>) =>
  (p as never as { show: { findMany: ReturnType<typeof vi.fn> } }).show.findMany;

describe("ScheduleService.resolve — kind mapping & fallback", () => {
  it("throws 404 when the channel does not exist", async () => {
    const svc = new ScheduleService(mockPrisma({ channel: null }));
    await expect(svc.resolve("nope", new Date(2026, 6, 20, 11, 0))).rejects.toBeInstanceOf(NotFoundException);
  });

  it("no active show → default with the channel's defaultClockId", async () => {
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [] }));
    const at = new Date(2026, 6, 20, 3, 0);
    await expect(svc.resolve("ch1", at)).resolves.toEqual({ kind: "default", clockId: "clkDef" });
  });

  it("no active show and no defaultClock → default with clockId null (silence-safe)", async () => {
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: null }, shows: [] }));
    const at = new Date(2026, 6, 20, 3, 0);
    await expect(svc.resolve("ch1", at)).resolves.toEqual({ kind: "default", clockId: null });
  });

  it("an active scheduled show → { kind: 'scheduled', clockId }", async () => {
    const at = new Date(2026, 6, 20, 11, 0);
    const s = show({ startTime: "10:00", endTime: "12:00", daysOfWeek: dow(at.getDay()), clockId: "clkX" });
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [s] }));
    const res = await svc.resolve("ch1", at);
    expect(res).toMatchObject({ kind: "scheduled", clockId: "clkX" });
    expect((res as { show: Show }).show.id).toBe("s1");
  });

  it("an active live show → { kind: 'live', ownerId } (resolver does NOT substitute defaultClock)", async () => {
    const at = new Date(2026, 6, 20, 11, 0);
    const s = show({ type: "live", clockId: null, ownerId: "u7", daysOfWeek: dow(at.getDay()) });
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [s] }));
    const res = await svc.resolve("ch1", at);
    expect(res).toMatchObject({ kind: "live", ownerId: "u7" });
    expect((res as { show: Show }).show.id).toBe("s1");
  });

  it("a show whose window does not contain the instant → default fallback", async () => {
    const at = new Date(2026, 6, 20, 13, 0); // after the 10:00–12:00 window
    const s = show({ startTime: "10:00", endTime: "12:00", daysOfWeek: dow(at.getDay()) });
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [s] }));
    await expect(svc.resolve("ch1", at)).resolves.toEqual({ kind: "default", clockId: "clkDef" });
  });
});

describe("ScheduleService.resolve — [startTime,endTime) boundaries", () => {
  const svcWith = (s: Show) =>
    new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [s] }));

  it("startTime is inclusive", async () => {
    const at = new Date(2026, 6, 20, 10, 0);
    const s = show({ startTime: "10:00", endTime: "12:00", daysOfWeek: dow(at.getDay()) });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toMatchObject({ kind: "scheduled" });
  });

  it("endTime is exclusive", async () => {
    const at = new Date(2026, 6, 20, 12, 0);
    const s = show({ startTime: "10:00", endTime: "12:00", daysOfWeek: dow(at.getDay()) });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toEqual({ kind: "default", clockId: "clkDef" });
  });
});

describe("ScheduleService.resolve — overnight wrap (endTime <= startTime)", () => {
  const svcWith = (s: Show) =>
    new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [s] }));

  it("evening portion is active on the start day", async () => {
    const at = new Date(2026, 6, 20, 23, 0); // 23:00, same day the show starts
    const s = show({ startTime: "22:00", endTime: "06:00", daysOfWeek: dow(at.getDay()) });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toMatchObject({ kind: "scheduled" });
  });

  it("morning portion is active from YESTERDAY's occurrence (the show belongs to its start day)", async () => {
    const at = new Date(2026, 6, 20, 5, 0); // 05:00 — the occurrence started 2026-07-19
    const startDay = new Date(2026, 6, 19);
    const s = show({ startTime: "22:00", endTime: "06:00", daysOfWeek: dow(startDay.getDay()) });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toMatchObject({ kind: "scheduled" });
  });

  it("morning is NOT active when only TODAY's weekday is enabled (gating is on the start day)", async () => {
    const at = new Date(2026, 6, 20, 5, 0);
    const today = new Date(2026, 6, 20);
    const yesterday = new Date(2026, 6, 19);
    // enable today's weekday only — the occurrence that could cover 05:00 started yesterday.
    expect(today.getDay()).not.toBe(yesterday.getDay());
    const s = show({ startTime: "22:00", endTime: "06:00", daysOfWeek: dow(today.getDay()) });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toEqual({ kind: "default", clockId: "clkDef" });
  });

  it("the off-gap between end and next start is inactive", async () => {
    const at = new Date(2026, 6, 20, 12, 0); // midday — outside 22:00→06:00
    const s = show({ startTime: "22:00", endTime: "06:00", daysOfWeek: dow(0, 1, 2, 3, 4, 5, 6) });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toEqual({ kind: "default", clockId: "clkDef" });
  });

  it("morning is exclusive at endTime", async () => {
    const at = new Date(2026, 6, 20, 6, 0); // exactly 06:00 — occurrence ended
    const startDay = new Date(2026, 6, 19);
    const s = show({ startTime: "22:00", endTime: "06:00", daysOfWeek: dow(startDay.getDay(), at.getDay()) });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toEqual({ kind: "default", clockId: "clkDef" });
  });
});

describe("ScheduleService.resolve — date-range bounds (on the start day)", () => {
  const svcWith = (s: Show) =>
    new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [s] }));

  it("active when the instant's day is within [dateStart, dateEnd]", async () => {
    const at = new Date(2026, 6, 20, 11, 0);
    const s = show({
      daysOfWeek: dow(at.getDay()),
      dateStart: new Date(2026, 6, 1),
      dateEnd: new Date(2026, 6, 31),
    });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toMatchObject({ kind: "scheduled" });
  });

  it("inactive before dateStart", async () => {
    const at = new Date(2026, 6, 20, 11, 0);
    const s = show({ daysOfWeek: dow(at.getDay()), dateStart: new Date(2026, 6, 21) });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toEqual({ kind: "default", clockId: "clkDef" });
  });

  it("inactive after dateEnd", async () => {
    const at = new Date(2026, 6, 20, 11, 0);
    const s = show({ daysOfWeek: dow(at.getDay()), dateEnd: new Date(2026, 6, 19) });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toEqual({ kind: "default", clockId: "clkDef" });
  });

  it("dateStart is inclusive of its own day", async () => {
    const at = new Date(2026, 6, 20, 11, 0);
    const s = show({ daysOfWeek: dow(at.getDay()), dateStart: new Date(2026, 6, 20) });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toMatchObject({ kind: "scheduled" });
  });

  it("dateEnd is inclusive of the whole day (time-of-day of dateEnd is ignored)", async () => {
    const at = new Date(2026, 6, 20, 23, 30);
    const s = show({
      startTime: "23:00",
      endTime: "23:59",
      daysOfWeek: dow(at.getDay()),
      dateEnd: new Date(2026, 6, 20, 0, 0), // midnight of the 20th, yet the 23:30 show still counts
    });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toMatchObject({ kind: "scheduled" });
  });

  it("the date range applies to the occurrence's START day, not the instant (overnight morning)", async () => {
    const at = new Date(2026, 6, 20, 5, 0); // occurrence started 2026-07-19
    const s = show({
      startTime: "22:00",
      endTime: "06:00",
      daysOfWeek: dow(0, 1, 2, 3, 4, 5, 6),
      dateStart: new Date(2026, 6, 20), // start day (the 19th) is before dateStart → inactive
    });
    await expect(svcWith(s).resolve("ch1", at)).resolves.toEqual({ kind: "default", clockId: "clkDef" });
  });
});

describe("ScheduleService.resolve — precedence among simultaneously-active shows", () => {
  it("higher priority wins", async () => {
    const at = new Date(2026, 6, 20, 11, 0);
    const lo = show({ id: "lo", priority: 1, clockId: "clkLo", daysOfWeek: dow(at.getDay()) });
    const hi = show({ id: "hi", priority: 5, clockId: "clkHi", daysOfWeek: dow(at.getDay()) });
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "d" }, shows: [lo, hi] }));
    const res = await svc.resolve("ch1", at);
    expect(res).toMatchObject({ kind: "scheduled", clockId: "clkHi" });
  });

  it("equal priority → most recently created wins", async () => {
    const at = new Date(2026, 6, 20, 11, 0);
    const older = show({
      id: "old",
      priority: 3,
      clockId: "clkOld",
      daysOfWeek: dow(at.getDay()),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = show({
      id: "new",
      priority: 3,
      clockId: "clkNew",
      daysOfWeek: dow(at.getDay()),
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "d" }, shows: [older, newer] }));
    const res = await svc.resolve("ch1", at);
    expect(res).toMatchObject({ kind: "scheduled", clockId: "clkNew" });
  });
});

describe("ScheduleService.activeLiveShowFor — grace window edges", () => {
  const liveShow = (o: Partial<Show> = {}) =>
    show({ type: "live", clockId: null, ownerId: "u1", startTime: "10:00", endTime: "12:00", ...o });

  it("queries only live shows owned by the user on this channel", async () => {
    const p = mockPrisma({ shows: [] });
    const svc = new ScheduleService(p);
    await svc.activeLiveShowFor("ch1", "u1", new Date(2026, 6, 20, 11, 0), 5);
    expect(showFindMany(p)).toHaveBeenCalledWith({ where: { channelId: "ch1", type: "live", ownerId: "u1" } });
  });

  it("no owned live show → null", async () => {
    const svc = new ScheduleService(mockPrisma({ shows: [] }));
    await expect(svc.activeLiveShowFor("ch1", "u1", new Date(2026, 6, 20, 11, 0), 5)).resolves.toBeNull();
  });

  it("active squarely inside the window → returns the show", async () => {
    const at = new Date(2026, 6, 20, 11, 0);
    const s = liveShow({ daysOfWeek: dow(at.getDay()) });
    const svc = new ScheduleService(mockPrisma({ shows: [s] }));
    const got = await svc.activeLiveShowFor("ch1", "u1", at, 5);
    expect(got?.id).toBe("s1");
  });

  it("early connect just inside grace before start → returns the show", async () => {
    const at = new Date(2026, 6, 20, 9, 56); // grace 5 → window reaches 10:01 ≥ start 10:00
    const s = liveShow({ daysOfWeek: dow(at.getDay()) });
    const svc = new ScheduleService(mockPrisma({ shows: [s] }));
    expect((await svc.activeLiveShowFor("ch1", "u1", at, 5))?.id).toBe("s1");
  });

  it("connect just outside grace before start → null", async () => {
    const at = new Date(2026, 6, 20, 9, 54); // grace 5 → window reaches only 09:59 < start 10:00
    const s = liveShow({ daysOfWeek: dow(at.getDay()) });
    const svc = new ScheduleService(mockPrisma({ shows: [s] }));
    expect(await svc.activeLiveShowFor("ch1", "u1", at, 5)).toBeNull();
  });

  it("overrun just inside grace after end → returns the show", async () => {
    const at = new Date(2026, 6, 20, 12, 4); // grace 5 → window starts 11:59 < end 12:00
    const s = liveShow({ daysOfWeek: dow(at.getDay()) });
    const svc = new ScheduleService(mockPrisma({ shows: [s] }));
    expect((await svc.activeLiveShowFor("ch1", "u1", at, 5))?.id).toBe("s1");
  });

  it("past end beyond grace → null", async () => {
    const at = new Date(2026, 6, 20, 12, 6); // grace 5 → window starts 12:01 ≥ end 12:00
    const s = liveShow({ daysOfWeek: dow(at.getDay()) });
    const svc = new ScheduleService(mockPrisma({ shows: [s] }));
    expect(await svc.activeLiveShowFor("ch1", "u1", at, 5)).toBeNull();
  });

  it("zero grace behaves like a plain point-in-window check", async () => {
    const at = new Date(2026, 6, 20, 9, 59);
    const s = liveShow({ daysOfWeek: dow(at.getDay()) });
    const svc = new ScheduleService(mockPrisma({ shows: [s] }));
    expect(await svc.activeLiveShowFor("ch1", "u1", at, 0)).toBeNull();
  });
});

describe("ScheduleService.nowNext — now summary + next transition within 24h", () => {
  it("no shows → now is default, next is null", async () => {
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [] }));
    const out = await svc.nowNext("ch1", new Date(2026, 6, 20, 9, 0));
    expect(out.now).toMatchObject({ kind: "default", clockId: "clkDef" });
    expect(out.next).toBeNull();
  });

  it("before a daily show → next is its START, with the scheduled resolution that follows", async () => {
    const at = new Date(2026, 6, 20, 9, 0);
    const s = show({ startTime: "10:00", endTime: "12:00", clockId: "clkX", daysOfWeek: dow(0, 1, 2, 3, 4, 5, 6) });
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [s] }));
    const out = await svc.nowNext("ch1", at);
    expect(out.now).toMatchObject({ kind: "default", clockId: "clkDef" });
    expect(out.next?.boundary).toBe("start");
    expect(out.next?.showId).toBe("s1");
    expect(new Date(out.next!.at)).toEqual(new Date(2026, 6, 20, 10, 0));
    expect(out.next?.resolution).toMatchObject({ kind: "scheduled", clockId: "clkX" });
  });

  it("inside a show → next is its END, with the default resolution that follows", async () => {
    const at = new Date(2026, 6, 20, 11, 0);
    const s = show({ startTime: "10:00", endTime: "12:00", clockId: "clkX", daysOfWeek: dow(0, 1, 2, 3, 4, 5, 6) });
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [s] }));
    const out = await svc.nowNext("ch1", at);
    expect(out.now).toMatchObject({ kind: "scheduled", clockId: "clkX" });
    expect(out.next?.boundary).toBe("end");
    expect(new Date(out.next!.at)).toEqual(new Date(2026, 6, 20, 12, 0));
    expect(out.next?.resolution).toMatchObject({ kind: "default", clockId: "clkDef" });
  });

  it("summarizes a live 'now' (ownerId, no clockId)", async () => {
    const at = new Date(2026, 6, 20, 17, 0);
    const s = show({ type: "live", clockId: null, ownerId: "u3", startTime: "16:00", endTime: "18:00", daysOfWeek: dow(at.getDay()) });
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [s] }));
    const out = await svc.nowNext("ch1", at);
    expect(out.now).toEqual({ kind: "live", showId: "s1", showTitle: "A Show", clockId: null, ownerId: "u3" });
    expect(out.next).toMatchObject({ boundary: "end", resolution: { kind: "default", clockId: "clkDef" } });
  });

  it("picks the earliest boundary among several shows", async () => {
    const at = new Date(2026, 6, 20, 9, 0);
    const early = show({ id: "e", startTime: "09:30", endTime: "10:00", clockId: "clkE", daysOfWeek: dow(0, 1, 2, 3, 4, 5, 6) });
    const late = show({ id: "l", startTime: "14:00", endTime: "15:00", clockId: "clkL", daysOfWeek: dow(0, 1, 2, 3, 4, 5, 6) });
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [late, early] }));
    const out = await svc.nowNext("ch1", at);
    expect(out.next?.showId).toBe("e");
    expect(new Date(out.next!.at)).toEqual(new Date(2026, 6, 20, 9, 30));
  });

  it("a show more than 24h away → next is null", async () => {
    const at = new Date(2026, 6, 20, 12, 0);
    // Airs only on `at`'s weekday, once a week → next occurrence is 7 days out.
    const s = show({ startTime: "13:00", endTime: "14:00", clockId: "clkX", daysOfWeek: dow(at.getDay()) });
    const svc = new ScheduleService(mockPrisma({ channel: { defaultClockId: "clkDef" }, shows: [s] }));
    const out = await svc.nowNext("ch1", at);
    // today's 13:00 start is still ahead within 24h
    expect(out.next?.boundary).toBe("start");
    // From just after today's window, the only remaining boundary this week is > 24h away.
    const out2 = await svc.nowNext("ch1", new Date(2026, 6, 20, 14, 30));
    expect(out2.next).toBeNull();
  });
});
