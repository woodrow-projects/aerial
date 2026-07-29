import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClocksService } from "./clocks.service";

/**
 * Unit tests for clock (clockwheel) CRUD with atomic slot-array replace (plan
 * Phase B). Prisma is mocked — these pin: name-uniqueness 409s, the transactional
 * replace semantics of the slot array (delete-all → createMany in one tx),
 * contiguous-position + playlist-existence 400s, and the explicit Restrict-delete
 * 409 that names the referencing channels and shows.
 */
const D = new Date("2026-07-20T00:00:00Z");

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.20.0",
  });
}

function mockPrisma() {
  const m: Record<string, unknown> = {
    clock: {
      create: vi.fn().mockResolvedValue({ id: "c1" }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    clockSlot: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    playlist: { findMany: vi.fn().mockResolvedValue([]) },
    channel: { findMany: vi.fn().mockResolvedValue([]) },
    show: { findMany: vi.fn().mockResolvedValue([]) },
  };
  // Interactive transaction: run the callback against the same mock delegates so
  // deleteMany/createMany call-order can be asserted.
  m.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(m));
  return m as never;
}

const clk = (p: ReturnType<typeof mockPrisma>) =>
  (p as never as { clock: Record<string, ReturnType<typeof vi.fn>> }).clock;
const slot = (p: ReturnType<typeof mockPrisma>) =>
  (p as never as { clockSlot: Record<string, ReturnType<typeof vi.fn>> }).clockSlot;
const pls = (p: ReturnType<typeof mockPrisma>) =>
  (p as never as { playlist: Record<string, ReturnType<typeof vi.fn>> }).playlist;
const chn = (p: ReturnType<typeof mockPrisma>) =>
  (p as never as { channel: Record<string, ReturnType<typeof vi.fn>> }).channel;
const shw = (p: ReturnType<typeof mockPrisma>) =>
  (p as never as { show: Record<string, ReturnType<typeof vi.fn>> }).show;
const txOf = (p: ReturnType<typeof mockPrisma>) =>
  (p as never as { $transaction: ReturnType<typeof vi.fn> }).$transaction;

function detailRow(slots: Array<{ position: number; playlistId: string; count: number; name: string }>) {
  return {
    id: "c1",
    name: "Daytime",
    createdAt: D,
    updatedAt: D,
    slots: slots.map((s) => ({
      position: s.position,
      playlistId: s.playlistId,
      count: s.count,
      playlist: { name: s.name },
    })),
  };
}

describe("ClocksService.create", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: ClocksService;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new ClocksService(prisma);
  });

  it("creates the clock and its slots in one transaction, then returns detail with playlist names", async () => {
    pls(prisma).findMany.mockResolvedValue([{ id: "pA" }, { id: "pB" }]);
    clk(prisma).create.mockResolvedValue({ id: "c1" });
    clk(prisma).findUnique.mockResolvedValue(
      detailRow([
        { position: 0, playlistId: "pA", count: 1, name: "Currents" },
        { position: 1, playlistId: "pB", count: 2, name: "Jingles" },
      ]),
    );

    const dto = await svc.create({
      name: "Daytime",
      slots: [
        { position: 0, playlistId: "pA", count: 1 },
        { position: 1, playlistId: "pB", count: 2 },
      ],
    });

    expect(txOf(prisma)).toHaveBeenCalledOnce();
    expect(clk(prisma).create).toHaveBeenCalledWith({ data: { name: "Daytime" } });
    expect(slot(prisma).createMany).toHaveBeenCalledWith({
      data: [
        { clockId: "c1", position: 0, playlistId: "pA", count: 1 },
        { clockId: "c1", position: 1, playlistId: "pB", count: 2 },
      ],
    });
    expect(dto).toMatchObject({
      id: "c1",
      name: "Daytime",
      slotCount: 2,
      slots: [
        { position: 0, playlistId: "pA", playlistName: "Currents", count: 1 },
        { position: 1, playlistId: "pB", playlistName: "Jingles", count: 2 },
      ],
    });
  });

  it("allows the same playlist in multiple slots (existence looked up once per distinct id)", async () => {
    pls(prisma).findMany.mockResolvedValue([{ id: "pA" }]);
    clk(prisma).findUnique.mockResolvedValue(detailRow([{ position: 0, playlistId: "pA", count: 1, name: "Currents" }]));

    await svc.create({
      name: "Loop",
      slots: [
        { position: 0, playlistId: "pA", count: 1 },
        { position: 1, playlistId: "pA", count: 1 },
      ],
    });

    expect(pls(prisma).findMany).toHaveBeenCalledWith({ where: { id: { in: ["pA"] } }, select: { id: true } });
  });

  it("rejects (400) non-contiguous slot positions before opening a transaction", async () => {
    pls(prisma).findMany.mockResolvedValue([{ id: "pA" }, { id: "pB" }]);
    await expect(
      svc.create({
        name: "Gappy",
        slots: [
          { position: 0, playlistId: "pA", count: 1 },
          { position: 2, playlistId: "pB", count: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(txOf(prisma)).not.toHaveBeenCalled();
  });

  it("rejects (400) duplicate slot positions", async () => {
    pls(prisma).findMany.mockResolvedValue([{ id: "pA" }, { id: "pB" }]);
    await expect(
      svc.create({
        name: "Dup",
        slots: [
          { position: 0, playlistId: "pA", count: 1 },
          { position: 0, playlistId: "pB", count: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(txOf(prisma)).not.toHaveBeenCalled();
  });

  it("rejects (400) when a referenced playlist does not exist, naming the missing id", async () => {
    pls(prisma).findMany.mockResolvedValue([{ id: "pA" }]); // pB missing
    const err = await svc
      .create({
        name: "Bad",
        slots: [
          { position: 0, playlistId: "pA", count: 1 },
          { position: 1, playlistId: "pB", count: 1 },
        ],
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String((err as BadRequestException).message)).toContain("pB");
    expect(txOf(prisma)).not.toHaveBeenCalled();
  });

  it("maps a duplicate-name unique violation to 409 Conflict", async () => {
    pls(prisma).findMany.mockResolvedValue([{ id: "pA" }]);
    clk(prisma).create.mockRejectedValue(p2002());
    await expect(
      svc.create({ name: "Daytime", slots: [{ position: 0, playlistId: "pA", count: 1 }] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("ClocksService.update", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: ClocksService;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new ClocksService(prisma);
  });

  it("throws 404 when the clock does not exist", async () => {
    clk(prisma).findUnique.mockResolvedValue(null);
    await expect(svc.update("nope", { name: "X" })).rejects.toBeInstanceOf(NotFoundException);
    expect(txOf(prisma)).not.toHaveBeenCalled();
  });

  it("replaces the whole slot array in one tx: delete-all then createMany in array order", async () => {
    clk(prisma).findUnique
      .mockResolvedValueOnce({ id: "c1", name: "Daytime" }) // existence
      .mockResolvedValueOnce(
        detailRow([
          { position: 0, playlistId: "pB", count: 1, name: "Jingles" },
          { position: 1, playlistId: "pA", count: 1, name: "Currents" },
        ]),
      ); // final detail read
    pls(prisma).findMany.mockResolvedValue([{ id: "pA" }, { id: "pB" }]);

    await svc.update("c1", {
      slots: [
        { position: 0, playlistId: "pB", count: 1 },
        { position: 1, playlistId: "pA", count: 1 },
      ],
    });

    expect(txOf(prisma)).toHaveBeenCalledOnce();
    expect(slot(prisma).deleteMany).toHaveBeenCalledWith({ where: { clockId: "c1" } });
    expect(slot(prisma).createMany).toHaveBeenCalledWith({
      data: [
        { clockId: "c1", position: 0, playlistId: "pB", count: 1 },
        { clockId: "c1", position: 1, playlistId: "pA", count: 1 },
      ],
    });
    const del = slot(prisma).deleteMany.mock.invocationCallOrder[0];
    const cre = slot(prisma).createMany.mock.invocationCallOrder[0];
    expect(del).toBeLessThan(cre);
  });

  it("updates the name without touching slots when slots are omitted", async () => {
    clk(prisma).findUnique
      .mockResolvedValueOnce({ id: "c1", name: "Old" })
      .mockResolvedValueOnce(detailRow([{ position: 0, playlistId: "pA", count: 1, name: "Currents" }]));

    await svc.update("c1", { name: "New" });

    expect(clk(prisma).update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { name: "New" } });
    expect(slot(prisma).deleteMany).not.toHaveBeenCalled();
    expect(slot(prisma).createMany).not.toHaveBeenCalled();
  });

  it("rejects (400) non-contiguous positions before opening a transaction", async () => {
    clk(prisma).findUnique.mockResolvedValueOnce({ id: "c1", name: "Daytime" });
    pls(prisma).findMany.mockResolvedValue([{ id: "pA" }]);
    await expect(
      svc.update("c1", { slots: [{ position: 1, playlistId: "pA", count: 1 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(txOf(prisma)).not.toHaveBeenCalled();
  });

  it("maps a duplicate-name unique violation to 409 Conflict", async () => {
    clk(prisma).findUnique.mockResolvedValueOnce({ id: "c1", name: "Daytime" });
    clk(prisma).update.mockRejectedValue(p2002());
    await expect(svc.update("c1", { name: "Taken" })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("ClocksService.get / list", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: ClocksService;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new ClocksService(prisma);
  });

  it("get returns slots with playlist names ordered by position", async () => {
    clk(prisma).findUnique.mockResolvedValue(
      detailRow([
        { position: 0, playlistId: "pA", count: 1, name: "Currents" },
        { position: 1, playlistId: "pB", count: 3, name: "Ads" },
      ]),
    );

    const dto = await svc.get("c1");

    expect(clk(prisma).findUnique).toHaveBeenCalledWith({
      where: { id: "c1" },
      include: { slots: { include: { playlist: { select: { name: true } } }, orderBy: { position: "asc" } } },
    });
    expect(dto.slotCount).toBe(2);
    expect(dto.slots).toEqual([
      { position: 0, playlistId: "pA", playlistName: "Currents", count: 1 },
      { position: 1, playlistId: "pB", playlistName: "Ads", count: 3 },
    ]);
  });

  it("get throws 404 when the clock does not exist", async () => {
    clk(prisma).findUnique.mockResolvedValue(null);
    await expect(svc.get("nope")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("list returns each clock with its slotCount, ordered by name", async () => {
    clk(prisma).findMany.mockResolvedValue([
      { id: "c1", name: "Daytime", createdAt: D, updatedAt: D, _count: { slots: 4 } },
    ]);
    const out = await svc.list();
    expect(clk(prisma).findMany).toHaveBeenCalledWith({
      orderBy: { name: "asc" },
      include: { _count: { select: { slots: true } } },
    });
    expect(out[0]).toMatchObject({ id: "c1", name: "Daytime", slotCount: 4 });
  });
});

describe("ClocksService.remove (explicit Restrict by channel default-clock / show)", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: ClocksService;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new ClocksService(prisma);
  });

  it("throws 404 when the clock does not exist", async () => {
    clk(prisma).findUnique.mockResolvedValue(null);
    await expect(svc.remove("nope")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("blocks deletion with a 409 naming the referencing channels and shows", async () => {
    clk(prisma).findUnique.mockResolvedValue({ id: "c1", name: "Daytime" });
    chn(prisma).findMany.mockResolvedValue([{ name: "Main" }]);
    shw(prisma).findMany.mockResolvedValue([{ title: "Breakfast" }, { title: "Drivetime" }]);

    const err = await svc.remove("c1").catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    const msg = String((err as ConflictException).message);
    expect(msg).toContain("Main");
    expect(msg).toContain("Breakfast");
    expect(msg).toContain("Drivetime");
    expect(clk(prisma).delete).not.toHaveBeenCalled();
  });

  it("blocks with a 409 when only a channel default-clock references it", async () => {
    clk(prisma).findUnique.mockResolvedValue({ id: "c1", name: "Daytime" });
    chn(prisma).findMany.mockResolvedValue([{ name: "Main" }]);
    shw(prisma).findMany.mockResolvedValue([]);
    await expect(svc.remove("c1")).rejects.toBeInstanceOf(ConflictException);
    expect(clk(prisma).delete).not.toHaveBeenCalled();
  });

  it("deletes when nothing references the clock", async () => {
    clk(prisma).findUnique.mockResolvedValue({ id: "c1", name: "Daytime" });
    chn(prisma).findMany.mockResolvedValue([]);
    shw(prisma).findMany.mockResolvedValue([]);
    await svc.remove("c1");
    expect(chn(prisma).findMany).toHaveBeenCalledWith({ where: { defaultClockId: "c1" }, select: { name: true } });
    expect(shw(prisma).findMany).toHaveBeenCalledWith({ where: { clockId: "c1" }, select: { title: true } });
    expect(clk(prisma).delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });
});
