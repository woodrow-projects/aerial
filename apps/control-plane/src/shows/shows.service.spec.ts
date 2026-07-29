import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Show } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShowsService } from "./shows.service";

/**
 * Show CRUD (plan Phase C/D). Prisma is mocked. Pins: channel-existence 404,
 * date-range (dateStart<=dateEnd) 400, clock/owner reference 400s, the discriminated
 * create mapping (scheduled→clockId, live→ownerId), TEXT/JSON column (de)coding,
 * channel-scoped 404s for get/update/remove, and the update ref-consistency guard.
 */
function row(overrides: Partial<Show> = {}): Show {
  return {
    id: "s1",
    channelId: "ch1",
    type: "scheduled",
    title: "Breakfast",
    clockId: "clk1",
    ownerId: null,
    startTime: "06:00",
    endTime: "10:00",
    daysOfWeek: "[1,2,3,4,5]",
    dateStart: null,
    dateEnd: null,
    priority: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  } as Show;
}

function mockPrisma() {
  const m = {
    channel: { findUnique: vi.fn().mockResolvedValue({ id: "ch1" }) },
    clock: { findUnique: vi.fn().mockResolvedValue({ id: "clk1" }) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: "u1" }) },
    show: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(row()),
      update: vi.fn().mockResolvedValue(row()),
      delete: vi.fn().mockResolvedValue(row()),
    },
  };
  return m as never;
}
type M = ReturnType<typeof mockPrisma>;
const chan = (p: M) => (p as never as { channel: Record<string, ReturnType<typeof vi.fn>> }).channel;
const clock = (p: M) => (p as never as { clock: Record<string, ReturnType<typeof vi.fn>> }).clock;
const user = (p: M) => (p as never as { user: Record<string, ReturnType<typeof vi.fn>> }).user;
const shows = (p: M) => (p as never as { show: Record<string, ReturnType<typeof vi.fn>> }).show;

describe("ShowsService.create", () => {
  let prisma: M;
  let svc: ShowsService;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new ShowsService(prisma);
  });

  it("404 when the channel does not exist", async () => {
    chan(prisma).findUnique.mockResolvedValue(null);
    await expect(
      svc.create("ghost", { type: "scheduled", title: "X", startTime: "10:00", endTime: "12:00", clockId: "clk1", daysOfWeek: [1], priority: 0 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(shows(prisma).create).not.toHaveBeenCalled();
  });

  it("creates a scheduled show: persists clockId, null ownerId, serialized daysOfWeek", async () => {
    clock(prisma).findUnique.mockResolvedValue({ id: "clkX" });
    shows(prisma).create.mockResolvedValue(row({ clockId: "clkX", daysOfWeek: "[1,3,5]" }));
    await svc.create("ch1", {
      type: "scheduled",
      title: "Daytime",
      startTime: "10:00",
      endTime: "12:00",
      clockId: "clkX",
      daysOfWeek: [1, 3, 5],
      priority: 2,
    });
    expect(shows(prisma).create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channelId: "ch1",
        type: "scheduled",
        title: "Daytime",
        clockId: "clkX",
        ownerId: null,
        startTime: "10:00",
        endTime: "12:00",
        daysOfWeek: "[1,3,5]",
        priority: 2,
      }),
    });
  });

  it("creates a live show: persists ownerId, null clockId", async () => {
    user(prisma).findUnique.mockResolvedValue({ id: "u7" });
    shows(prisma).create.mockResolvedValue(row({ type: "live", clockId: null, ownerId: "u7" }));
    await svc.create("ch1", {
      type: "live",
      title: "Drive",
      startTime: "16:00",
      endTime: "18:00",
      ownerId: "u7",
      daysOfWeek: [1, 2, 3, 4, 5],
      priority: 0,
    });
    expect(shows(prisma).create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "live", ownerId: "u7", clockId: null }),
    });
  });

  it("400 when a scheduled show references a nonexistent clock", async () => {
    clock(prisma).findUnique.mockResolvedValue(null);
    await expect(
      svc.create("ch1", { type: "scheduled", title: "X", startTime: "10:00", endTime: "12:00", clockId: "ghost", daysOfWeek: [1], priority: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(shows(prisma).create).not.toHaveBeenCalled();
  });

  it("400 when a live show references a nonexistent owner (user)", async () => {
    user(prisma).findUnique.mockResolvedValue(null);
    await expect(
      svc.create("ch1", { type: "live", title: "X", startTime: "10:00", endTime: "12:00", ownerId: "ghost", daysOfWeek: [1], priority: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(shows(prisma).create).not.toHaveBeenCalled();
  });

  it("400 when dateStart is after dateEnd", async () => {
    await expect(
      svc.create("ch1", {
        type: "scheduled",
        title: "X",
        startTime: "10:00",
        endTime: "12:00",
        clockId: "clk1",
        daysOfWeek: [1],
        priority: 0,
        dateStart: new Date(2026, 6, 20),
        dateEnd: new Date(2026, 6, 10),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(shows(prisma).create).not.toHaveBeenCalled();
  });

  it("allows dateStart == dateEnd (a single-day run)", async () => {
    await svc.create("ch1", {
      type: "scheduled",
      title: "X",
      startTime: "10:00",
      endTime: "12:00",
      clockId: "clk1",
      daysOfWeek: [1],
      priority: 0,
      dateStart: new Date(2026, 6, 20),
      dateEnd: new Date(2026, 6, 20),
    });
    expect(shows(prisma).create).toHaveBeenCalledOnce();
  });
});

describe("ShowsService.list / get", () => {
  let prisma: M;
  let svc: ShowsService;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new ShowsService(prisma);
  });

  it("list 404s when the channel does not exist", async () => {
    chan(prisma).findUnique.mockResolvedValue(null);
    await expect(svc.list("ghost")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("list decodes TEXT/JSON columns into the DTO", async () => {
    shows(prisma).findMany.mockResolvedValue([
      row({ type: "scheduled", daysOfWeek: "[1,2,3,4,5]", dateStart: new Date("2026-07-01T00:00:00Z"), dateEnd: null }),
    ]);
    const out = await svc.list("ch1");
    expect(out[0]).toMatchObject({
      id: "s1",
      channelId: "ch1",
      type: "scheduled",
      daysOfWeek: [1, 2, 3, 4, 5],
      dateStart: "2026-07-01T00:00:00.000Z",
      dateEnd: null,
      clockId: "clk1",
      ownerId: null,
    });
  });

  it("get 404s when the show belongs to a different channel", async () => {
    shows(prisma).findUnique.mockResolvedValue(row({ channelId: "other" }));
    await expect(svc.get("ch1", "s1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("get returns the DTO when the show belongs to the channel", async () => {
    shows(prisma).findUnique.mockResolvedValue(row());
    await expect(svc.get("ch1", "s1")).resolves.toMatchObject({ id: "s1", channelId: "ch1" });
  });
});

describe("ShowsService.update", () => {
  let prisma: M;
  let svc: ShowsService;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new ShowsService(prisma);
  });

  it("404 when the show is missing or on a different channel", async () => {
    shows(prisma).findUnique.mockResolvedValue(null);
    await expect(svc.update("ch1", "s1", { title: "New" })).rejects.toBeInstanceOf(NotFoundException);
    shows(prisma).findUnique.mockResolvedValue(row({ channelId: "other" }));
    await expect(svc.update("ch1", "s1", { title: "New" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("updates schedule fields, serializing daysOfWeek", async () => {
    shows(prisma).findUnique.mockResolvedValue(row());
    await svc.update("ch1", "s1", { title: "Renamed", daysOfWeek: [0, 6], priority: 4 });
    expect(shows(prisma).update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({ title: "Renamed", daysOfWeek: "[0,6]", priority: 4 }),
    });
  });

  it("rejects clockId on a live show (400) and never writes", async () => {
    shows(prisma).findUnique.mockResolvedValue(row({ type: "live", clockId: null, ownerId: "u1" }));
    await expect(svc.update("ch1", "s1", { clockId: "clk9" })).rejects.toBeInstanceOf(BadRequestException);
    expect(shows(prisma).update).not.toHaveBeenCalled();
  });

  it("rejects ownerId on a scheduled show (400) and never writes", async () => {
    shows(prisma).findUnique.mockResolvedValue(row({ type: "scheduled", clockId: "clk1" }));
    await expect(svc.update("ch1", "s1", { ownerId: "u9" })).rejects.toBeInstanceOf(BadRequestException);
    expect(shows(prisma).update).not.toHaveBeenCalled();
  });

  it("accepts a valid clockId on a scheduled show and writes it", async () => {
    shows(prisma).findUnique.mockResolvedValue(row({ type: "scheduled" }));
    clock(prisma).findUnique.mockResolvedValue({ id: "clk9" });
    await svc.update("ch1", "s1", { clockId: "clk9" });
    expect(shows(prisma).update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({ clockId: "clk9" }),
    });
  });

  it("accepts a valid ownerId on a live show and writes it", async () => {
    shows(prisma).findUnique.mockResolvedValue(row({ type: "live", clockId: null, ownerId: "u1" }));
    user(prisma).findUnique.mockResolvedValue({ id: "u9" });
    await svc.update("ch1", "s1", { ownerId: "u9" });
    expect(shows(prisma).update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({ ownerId: "u9" }),
    });
  });

  it("validates a new clockId exists for a scheduled show", async () => {
    shows(prisma).findUnique.mockResolvedValue(row({ type: "scheduled" }));
    clock(prisma).findUnique.mockResolvedValue(null);
    await expect(svc.update("ch1", "s1", { clockId: "ghost" })).rejects.toBeInstanceOf(BadRequestException);
    expect(shows(prisma).update).not.toHaveBeenCalled();
  });

  it("validates a new ownerId exists for a live show", async () => {
    shows(prisma).findUnique.mockResolvedValue(row({ type: "live", clockId: null, ownerId: "u1" }));
    user(prisma).findUnique.mockResolvedValue(null);
    await expect(svc.update("ch1", "s1", { ownerId: "ghost" })).rejects.toBeInstanceOf(BadRequestException);
    expect(shows(prisma).update).not.toHaveBeenCalled();
  });

  it("400 when the merged date range is inverted (existing dateStart + new earlier dateEnd)", async () => {
    shows(prisma).findUnique.mockResolvedValue(row({ dateStart: new Date(2026, 6, 20), dateEnd: null }));
    await expect(svc.update("ch1", "s1", { dateEnd: new Date(2026, 6, 10) })).rejects.toBeInstanceOf(BadRequestException);
    expect(shows(prisma).update).not.toHaveBeenCalled();
  });

  it("clears a date bound when passed null", async () => {
    shows(prisma).findUnique.mockResolvedValue(row({ dateStart: new Date(2026, 6, 1), dateEnd: new Date(2026, 6, 30) }));
    await svc.update("ch1", "s1", { dateEnd: null });
    expect(shows(prisma).update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({ dateEnd: null }),
    });
  });
});

describe("ShowsService.remove", () => {
  let prisma: M;
  let svc: ShowsService;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new ShowsService(prisma);
  });

  it("404 when the show is missing or on a different channel", async () => {
    shows(prisma).findUnique.mockResolvedValue(row({ channelId: "other" }));
    await expect(svc.remove("ch1", "s1")).rejects.toBeInstanceOf(NotFoundException);
    expect(shows(prisma).delete).not.toHaveBeenCalled();
  });

  it("deletes when the show belongs to the channel", async () => {
    shows(prisma).findUnique.mockResolvedValue(row());
    await svc.remove("ch1", "s1");
    expect(shows(prisma).delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });
});
