import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionsService } from "./sessions.service";

/**
 * Unit tests for per-stream session logging (ADR D10: mount/time/source IP).
 * Prisma is mocked — these pin the open/close contract and its fail-safe,
 * best-effort semantics (a persistence error must never break the engine hook)
 * without a database.
 */
function mockPrisma() {
  return {
    channel: { findUnique: vi.fn() },
    streamSession: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
}

describe("SessionsService.open (streamer connect)", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: SessionsService;

  beforeEach(() => {
    prisma = mockPrisma();
    svc = new SessionsService(prisma as never);
  });

  it("opens a session with the channel's id and mount, defaulting sourceIp to null", async () => {
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", slug: "jazz", mount: "/jazz" });

    await svc.open("jazz");

    expect(prisma.channel.findUnique).toHaveBeenCalledWith({ where: { slug: "jazz" } });
    expect(prisma.streamSession.create).toHaveBeenCalledWith({
      data: { channelId: "c1", mount: "/jazz", sourceIp: null },
    });
  });

  it("records a source IP when one is supplied", async () => {
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", slug: "jazz", mount: "/jazz" });

    await svc.open("jazz", "203.0.113.7");

    expect(prisma.streamSession.create).toHaveBeenCalledWith({
      data: { channelId: "c1", mount: "/jazz", sourceIp: "203.0.113.7" },
    });
  });

  it("closes any dangling open session for the channel before opening a new one (double-connect hygiene)", async () => {
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", slug: "jazz", mount: "/jazz" });

    await svc.open("jazz");

    expect(prisma.streamSession.updateMany).toHaveBeenCalledWith({
      where: { channelId: "c1", endedAt: null },
      data: { endedAt: expect.any(Date) },
    });
    // the stale close must happen before the fresh insert
    const closeOrder = prisma.streamSession.updateMany.mock.invocationCallOrder[0];
    const createOrder = prisma.streamSession.create.mock.invocationCallOrder[0];
    expect(closeOrder).toBeLessThan(createOrder);
  });

  it("ignores a connect for an unknown channel without writing a session", async () => {
    prisma.channel.findUnique.mockResolvedValue(null);

    await svc.open("ghost");

    expect(prisma.streamSession.create).not.toHaveBeenCalled();
    expect(prisma.streamSession.updateMany).not.toHaveBeenCalled();
  });

  it("swallows a persistence failure so the engine hook is never broken", async () => {
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", mount: "/jazz" });
    prisma.streamSession.create.mockRejectedValue(new Error("db down"));

    await expect(svc.open("jazz")).resolves.toBeUndefined();
  });
});

describe("SessionsService.close (streamer disconnect)", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: SessionsService;

  beforeEach(() => {
    prisma = mockPrisma();
    svc = new SessionsService(prisma as never);
  });

  it("ends the most recent open session for the channel", async () => {
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", mount: "/jazz" });
    prisma.streamSession.findFirst.mockResolvedValue({ id: "s1" });

    await svc.close("jazz");

    expect(prisma.streamSession.findFirst).toHaveBeenCalledWith({
      where: { channelId: "c1", endedAt: null },
      orderBy: { startedAt: "desc" },
    });
    expect(prisma.streamSession.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { endedAt: expect.any(Date) },
    });
  });

  it("tolerates a disconnect with no open session (no-op, never throws)", async () => {
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", mount: "/jazz" });
    prisma.streamSession.findFirst.mockResolvedValue(null);

    await expect(svc.close("jazz")).resolves.toBeUndefined();
    expect(prisma.streamSession.update).not.toHaveBeenCalled();
  });

  it("ignores a disconnect for an unknown channel", async () => {
    prisma.channel.findUnique.mockResolvedValue(null);

    await svc.close("ghost");

    expect(prisma.streamSession.findFirst).not.toHaveBeenCalled();
    expect(prisma.streamSession.update).not.toHaveBeenCalled();
  });

  it("swallows a persistence failure so the engine hook is never broken", async () => {
    prisma.channel.findUnique.mockRejectedValue(new Error("db down"));

    await expect(svc.close("jazz")).resolves.toBeUndefined();
  });
});

describe("SessionsService.onApplicationBootstrap (crash-recovery sweep)", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: SessionsService;

  beforeEach(() => {
    prisma = mockPrisma();
    svc = new SessionsService(prisma as never);
  });

  it("closes every session left open by a prior unclean shutdown", async () => {
    prisma.streamSession.updateMany.mockResolvedValue({ count: 2 });

    await svc.onApplicationBootstrap();

    expect(prisma.streamSession.updateMany).toHaveBeenCalledWith({
      where: { endedAt: null },
      data: { endedAt: expect.any(Date) },
    });
  });

  it("swallows a sweep failure so it never blocks app start", async () => {
    prisma.streamSession.updateMany.mockRejectedValue(new Error("db down"));

    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
