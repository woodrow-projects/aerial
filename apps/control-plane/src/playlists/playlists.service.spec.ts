import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaylistsService } from "./playlists.service";

/**
 * Unit tests for playlist CRUD + atomic track-membership replace (plan Phase A).
 * Prisma is mocked — these pin: name-uniqueness 409s, the transactional replace
 * semantics of PUT :id/tracks (validate-all-exist → delete → recreate in order),
 * validation 400s, and the Restrict-delete 409 that names the referencing clocks.
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
    playlist: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    track: { findMany: vi.fn() },
    playlistTrack: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    clockSlot: { findMany: vi.fn().mockResolvedValue([]) },
  };
  // Interactive transaction: run the callback against the same mock delegates so
  // deleteMany/createMany call-order can be asserted.
  m.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(m));
  return m as never;
}

describe("PlaylistsService.create", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: PlaylistsService;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new PlaylistsService(prisma);
  });

  it("creates a playlist and returns it with trackCount 0", async () => {
    (prisma as never as { playlist: { create: ReturnType<typeof vi.fn> } }).playlist.create.mockResolvedValue({
      id: "p1",
      name: "Currents",
      order: "shuffle",
      dedupWindowMin: 60,
      isJingle: false,
      createdAt: D,
      updatedAt: D,
      _count: { tracks: 0 },
    });

    const dto = await svc.create({ name: "Currents", order: "shuffle", dedupWindowMin: 60, isJingle: false });

    expect((prisma as never as { playlist: { create: ReturnType<typeof vi.fn> } }).playlist.create).toHaveBeenCalledWith({
      data: { name: "Currents", order: "shuffle", dedupWindowMin: 60, isJingle: false },
      include: { _count: { select: { tracks: true } } },
    });
    expect(dto).toMatchObject({ id: "p1", name: "Currents", order: "shuffle", dedupWindowMin: 60, isJingle: false, trackCount: 0 });
  });

  it("maps a duplicate-name unique violation to 409 Conflict", async () => {
    (prisma as never as { playlist: { create: ReturnType<typeof vi.fn> } }).playlist.create.mockRejectedValue(p2002());
    await expect(
      svc.create({ name: "Currents", order: "shuffle", dedupWindowMin: 60, isJingle: false }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("PlaylistsService.update", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: PlaylistsService;
  const pl = () => (prisma as never as { playlist: Record<string, ReturnType<typeof vi.fn>> }).playlist;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new PlaylistsService(prisma);
  });

  it("updates only the provided fields (undefined = untouched) and returns the new state", async () => {
    pl().findUnique.mockResolvedValue({ id: "p1" });
    pl().update.mockResolvedValue({
      id: "p1",
      name: "New",
      order: "sequential",
      dedupWindowMin: 60,
      isJingle: false,
      createdAt: D,
      updatedAt: D,
      _count: { tracks: 2 },
    });

    const dto = await svc.update("p1", { name: "New", order: "sequential" });

    expect(pl().update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { name: "New", order: "sequential", dedupWindowMin: undefined, isJingle: undefined },
      include: { _count: { select: { tracks: true } } },
    });
    expect(dto).toMatchObject({ name: "New", order: "sequential", trackCount: 2 });
  });

  it("throws 404 when the playlist does not exist", async () => {
    pl().findUnique.mockResolvedValue(null);
    await expect(svc.update("nope", { name: "x" })).rejects.toBeInstanceOf(NotFoundException);
    expect(pl().update).not.toHaveBeenCalled();
  });

  it("maps a duplicate-name unique violation to 409 Conflict", async () => {
    pl().findUnique.mockResolvedValue({ id: "p1" });
    pl().update.mockRejectedValue(p2002());
    await expect(svc.update("p1", { name: "Taken" })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("PlaylistsService.get / list", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: PlaylistsService;
  const pl = () => (prisma as never as { playlist: Record<string, ReturnType<typeof vi.fn>> }).playlist;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new PlaylistsService(prisma);
  });

  it("get returns detail with tracks ordered by position", async () => {
    pl().findUnique.mockResolvedValue({
      id: "p1",
      name: "Currents",
      order: "shuffle",
      dedupWindowMin: 60,
      isJingle: false,
      createdAt: D,
      updatedAt: D,
      tracks: [
        { position: 0, trackId: "t1", track: { title: "A", artist: "X", fileName: "a.mp3", durationSec: 100 } },
        { position: 1, trackId: "t2", track: { title: "B", artist: null, fileName: "b.mp3", durationSec: 120 } },
      ],
    });

    const dto = await svc.get("p1");

    expect(pl().findUnique).toHaveBeenCalledWith({
      where: { id: "p1" },
      include: { tracks: { include: { track: true }, orderBy: { position: "asc" } } },
    });
    expect(dto.trackCount).toBe(2);
    expect(dto.tracks).toEqual([
      { trackId: "t1", position: 0, title: "A", artist: "X", fileName: "a.mp3", durationSec: 100 },
      { trackId: "t2", position: 1, title: "B", artist: null, fileName: "b.mp3", durationSec: 120 },
    ]);
  });

  it("get throws 404 when the playlist does not exist", async () => {
    pl().findUnique.mockResolvedValue(null);
    await expect(svc.get("nope")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("list returns each playlist with its trackCount, ordered by name", async () => {
    pl().findMany.mockResolvedValue([
      { id: "p1", name: "A", order: "shuffle", dedupWindowMin: 60, isJingle: false, createdAt: D, updatedAt: D, _count: { tracks: 3 } },
    ]);
    const out = await svc.list();
    expect(pl().findMany).toHaveBeenCalledWith({ orderBy: { name: "asc" }, include: { _count: { select: { tracks: true } } } });
    expect(out[0]).toMatchObject({ id: "p1", name: "A", trackCount: 3 });
  });
});

describe("PlaylistsService.setTracks (atomic membership replace)", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: PlaylistsService;
  const pl = () => (prisma as never as { playlist: Record<string, ReturnType<typeof vi.fn>> }).playlist;
  const tk = () => (prisma as never as { track: Record<string, ReturnType<typeof vi.fn>> }).track;
  const pt = () => (prisma as never as { playlistTrack: Record<string, ReturnType<typeof vi.fn>> }).playlistTrack;
  const tx = () => (prisma as never as { $transaction: ReturnType<typeof vi.fn> }).$transaction;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new PlaylistsService(prisma);
  });

  it("replaces membership in one transaction: delete-all then createMany in array order", async () => {
    pl().findUnique
      .mockResolvedValueOnce({ id: "p1" }) // existence
      .mockResolvedValueOnce({
        id: "p1",
        name: "Currents",
        order: "shuffle",
        dedupWindowMin: 60,
        isJingle: false,
        createdAt: D,
        updatedAt: D,
        tracks: [],
      }); // final detail read
    tk().findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);

    await svc.setTracks("p1", ["t2", "t1"]);

    expect(tk().findMany).toHaveBeenCalledWith({ where: { id: { in: ["t2", "t1"] } }, select: { id: true } });
    expect(tx()).toHaveBeenCalledOnce();
    expect(pt().deleteMany).toHaveBeenCalledWith({ where: { playlistId: "p1" } });
    expect(pt().createMany).toHaveBeenCalledWith({
      data: [
        { playlistId: "p1", trackId: "t2", position: 0 },
        { playlistId: "p1", trackId: "t1", position: 1 },
      ],
    });
    const del = pt().deleteMany.mock.invocationCallOrder[0];
    const cre = pt().createMany.mock.invocationCallOrder[0];
    expect(del).toBeLessThan(cre);
  });

  it("rejects (400) when any track id does not exist, before opening a transaction", async () => {
    pl().findUnique.mockResolvedValueOnce({ id: "p1" });
    tk().findMany.mockResolvedValue([{ id: "t1" }]); // t2 missing

    await expect(svc.setTracks("p1", ["t1", "t2"])).rejects.toBeInstanceOf(BadRequestException);
    expect(tx()).not.toHaveBeenCalled();
  });

  it("rejects (400) duplicate track ids without hitting the DB", async () => {
    pl().findUnique.mockResolvedValueOnce({ id: "p1" });
    await expect(svc.setTracks("p1", ["t1", "t1"])).rejects.toBeInstanceOf(BadRequestException);
    expect(tk().findMany).not.toHaveBeenCalled();
    expect(tx()).not.toHaveBeenCalled();
  });

  it("clears membership on an empty array (deleteMany, no createMany)", async () => {
    pl().findUnique
      .mockResolvedValueOnce({ id: "p1" })
      .mockResolvedValueOnce({ id: "p1", name: "C", order: "shuffle", dedupWindowMin: 60, isJingle: false, createdAt: D, updatedAt: D, tracks: [] });

    await svc.setTracks("p1", []);

    expect(tk().findMany).not.toHaveBeenCalled();
    expect(pt().deleteMany).toHaveBeenCalledWith({ where: { playlistId: "p1" } });
    expect(pt().createMany).not.toHaveBeenCalled();
  });

  it("throws 404 when the playlist does not exist", async () => {
    pl().findUnique.mockResolvedValueOnce(null);
    await expect(svc.setTracks("nope", ["t1"])).rejects.toBeInstanceOf(NotFoundException);
    expect(tx()).not.toHaveBeenCalled();
  });
});

describe("PlaylistsService.remove (Restrict-blocked by clock slots)", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: PlaylistsService;
  const pl = () => (prisma as never as { playlist: Record<string, ReturnType<typeof vi.fn>> }).playlist;
  const cs = () => (prisma as never as { clockSlot: Record<string, ReturnType<typeof vi.fn>> }).clockSlot;
  beforeEach(() => {
    prisma = mockPrisma();
    svc = new PlaylistsService(prisma);
  });

  it("throws 404 when the playlist does not exist", async () => {
    pl().findUnique.mockResolvedValue(null);
    await expect(svc.remove("nope")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("blocks deletion with a 409 naming the distinct referencing clocks", async () => {
    pl().findUnique.mockResolvedValue({ id: "p1" });
    cs().findMany.mockResolvedValue([
      { clock: { name: "Daytime" } },
      { clock: { name: "Daytime" } },
      { clock: { name: "Overnight" } },
    ]);

    const err = await svc.remove("p1").catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    const msg = String((err as ConflictException).message);
    expect(msg).toContain("Daytime");
    expect(msg).toContain("Overnight");
    // de-duped: "Daytime" named once
    expect(msg.match(/Daytime/g)).toHaveLength(1);
    expect(pl().delete).not.toHaveBeenCalled();
  });

  it("deletes when no clock slot references the playlist", async () => {
    pl().findUnique.mockResolvedValue({ id: "p1" });
    cs().findMany.mockResolvedValue([]);
    await svc.remove("p1");
    expect(pl().delete).toHaveBeenCalledWith({ where: { id: "p1" } });
  });
});
