import * as bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamerAuthService } from "./streamer-auth.service";
import type { ScheduleService } from "../shows/schedule.service";
import type { StreamKeysService } from "../channels/stream-keys.service";

/**
 * Schedule-aware, enforced-by-default streamer ingest auth (ADR D18 / plan Phase D).
 * Prisma, the ScheduleService, and the legacy per-channel StreamKeysService are all
 * mocked — no DB, no engine. Covers: user identification by streamer key, the
 * enforceSchedule gate (grace-window via ScheduleService), the advisory
 * (enforceSchedule=false) path, the legacy per-channel fallback, and the
 * lastAccepted TTL map.
 */
const PLAINTEXT = "correct-horse-battery-staple";
let userKeyHash: string;

function mockPrisma() {
  return {
    channel: { findUnique: vi.fn() },
    streamerKey: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

function mockSchedule() {
  return { activeLiveShowFor: vi.fn() };
}

function mockLegacy() {
  return { verify: vi.fn().mockResolvedValue(false) };
}

function build() {
  const prisma = mockPrisma();
  const schedule = mockSchedule();
  const legacy = mockLegacy();
  const service = new StreamerAuthService(
    prisma as never,
    schedule as unknown as ScheduleService,
    legacy as unknown as StreamKeysService,
  );
  return { prisma, schedule, legacy, service };
}

beforeEach(async () => {
  if (!userKeyHash) userKeyHash = await bcrypt.hash(PLAINTEXT, 4); // low cost — test speed only
});

describe("StreamerAuthService.verify — channel gating", () => {
  it("denies when the mount has no channel (no key scan)", async () => {
    const { prisma, service } = build();
    prisma.channel.findUnique.mockResolvedValue(null);
    expect(await service.verify("/ghost", PLAINTEXT)).toEqual({ ok: false });
    expect(prisma.streamerKey.findMany).not.toHaveBeenCalled();
  });

  it("denies when the channel is inactive (kill switch)", async () => {
    const { prisma, service } = build();
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", isActive: false, enforceSchedule: false });
    expect(await service.verify("/jazz", PLAINTEXT)).toEqual({ ok: false });
  });
});

describe("StreamerAuthService.verify — enforceSchedule = true", () => {
  it("allows only when the user owns a live show active in the grace window", async () => {
    const { prisma, schedule, service } = build();
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", isActive: true, enforceSchedule: true });
    prisma.streamerKey.findMany.mockResolvedValue([{ userId: "u1", keyHash: userKeyHash }]);
    schedule.activeLiveShowFor.mockResolvedValue({ id: "show_1" });

    const out = await service.verify("/jazz", PLAINTEXT, "203.0.113.7");

    expect(out).toEqual({ ok: true, userId: "u1" });
    // grace window uses env.schedule.graceMin (default 5) and the identified user.
    expect(schedule.activeLiveShowFor).toHaveBeenCalledWith("c1", "u1", expect.any(Date), 5);
    // success recorded for the connect→status correlation.
    expect(service.lastAccepted("/jazz")).toEqual({ userId: "u1", address: "203.0.113.7" });
  });

  it("denies when the identified user has no active live show now (± grace)", async () => {
    const { prisma, schedule, service } = build();
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", isActive: true, enforceSchedule: true });
    prisma.streamerKey.findMany.mockResolvedValue([{ userId: "u1", keyHash: userKeyHash }]);
    schedule.activeLiveShowFor.mockResolvedValue(null);

    expect(await service.verify("/jazz", PLAINTEXT)).toEqual({ ok: false });
    expect(service.lastAccepted("/jazz")).toBeNull();
  });

  it("never special-cases a role — the schedule gate is the only test (predictable)", async () => {
    const { prisma, schedule, service } = build();
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", isActive: true, enforceSchedule: true });
    prisma.streamerKey.findMany.mockResolvedValue([{ userId: "admin_user", keyHash: userKeyHash }]);
    schedule.activeLiveShowFor.mockResolvedValue(null);

    // An admin with no scheduled live show is still denied — no role bypass.
    expect(await service.verify("/jazz", PLAINTEXT)).toEqual({ ok: false });
  });
});

describe("StreamerAuthService.verify — enforceSchedule = false (advisory)", () => {
  it("allows any valid user key anytime and never consults the schedule", async () => {
    const { prisma, schedule, service } = build();
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", isActive: true, enforceSchedule: false });
    prisma.streamerKey.findMany.mockResolvedValue([{ userId: "u2", keyHash: userKeyHash }]);

    const out = await service.verify("/jazz", PLAINTEXT, "198.51.100.9");

    expect(out).toEqual({ ok: true, userId: "u2" });
    expect(schedule.activeLiveShowFor).not.toHaveBeenCalled();
    expect(service.lastAccepted("/jazz")).toEqual({ userId: "u2", address: "198.51.100.9" });
  });

  it("denies when no user key matches and legacy verify also fails", async () => {
    const { prisma, legacy, service } = build();
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", isActive: true, enforceSchedule: false });
    prisma.streamerKey.findMany.mockResolvedValue([{ userId: "u2", keyHash: userKeyHash }]);
    legacy.verify.mockResolvedValue(false);

    expect(await service.verify("/jazz", "not-the-key")).toEqual({ ok: false });
  });
});

describe("StreamerAuthService.verify — legacy per-channel fallback", () => {
  it("falls back to the legacy StreamKey when no user key matches (advisory, no user identity)", async () => {
    const { prisma, legacy, service } = build();
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", isActive: true, enforceSchedule: true });
    prisma.streamerKey.findMany.mockResolvedValue([]); // no per-user key
    legacy.verify.mockResolvedValue(true);

    const out = await service.verify("/jazz", "legacy-channel-secret", "192.0.2.5");

    expect(out).toEqual({ ok: true });
    expect(out.userId).toBeUndefined();
    expect(legacy.verify).toHaveBeenCalledWith("/jazz", "legacy-channel-secret");
    // No identified user → nothing to record for the who-was-on-air correlation.
    expect(service.lastAccepted("/jazz")).toBeNull();
  });

  it("only falls back when NO user key matched (a matching user key wins outright)", async () => {
    const { prisma, legacy, schedule, service } = build();
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", isActive: true, enforceSchedule: false });
    prisma.streamerKey.findMany.mockResolvedValue([{ userId: "u2", keyHash: userKeyHash }]);

    await service.verify("/jazz", PLAINTEXT);
    expect(legacy.verify).not.toHaveBeenCalled();
    expect(schedule.activeLiveShowFor).not.toHaveBeenCalled();
  });
});

describe("StreamerAuthService.lastAccepted — in-memory TTL map", () => {
  it("returns null for a mount with no recent accepted connection", () => {
    const { service } = build();
    expect(service.lastAccepted("/never")).toBeNull();
  });

  it("returns the last accepted user+address and is cleared only by TTL (not by reading)", async () => {
    const { prisma, service } = build();
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", isActive: true, enforceSchedule: false });
    prisma.streamerKey.findMany.mockResolvedValue([{ userId: "u1", keyHash: userKeyHash }]);

    await service.verify("/jazz", PLAINTEXT, "203.0.113.7");

    // Repeated reads within the TTL keep returning the entry — reading does not clear it.
    expect(service.lastAccepted("/jazz")).toEqual({ userId: "u1", address: "203.0.113.7" });
    expect(service.lastAccepted("/jazz")).toEqual({ userId: "u1", address: "203.0.113.7" });

    const past = Date.now();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(past + 10 * 60_000 + 1); // just past the 10-minute TTL
      expect(service.lastAccepted("/jazz")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records without an address when none is presented", async () => {
    const { prisma, service } = build();
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", isActive: true, enforceSchedule: false });
    prisma.streamerKey.findMany.mockResolvedValue([{ userId: "u1", keyHash: userKeyHash }]);

    await service.verify("/jazz", PLAINTEXT);
    expect(service.lastAccepted("/jazz")).toEqual({ userId: "u1" });
  });
});

describe("StreamerAuthService — lastAccepted staleness (review finding)", () => {
  it("a legacy-key success clears any prior per-user attribution for the mount", async () => {
    const { prisma, schedule, legacy, service } = build();
    prisma.channel.findUnique.mockResolvedValue({ id: "c1", mount: "/main", isActive: true, enforceSchedule: false });
    prisma.streamerKey.findMany.mockResolvedValue([{ userId: "u1", keyHash: userKeyHash }]);

    // Per-user key connects: attribution recorded.
    await service.verify("/main", PLAINTEXT, "203.0.113.9");
    expect(service.lastAccepted("/main")?.userId).toBe("u1");

    // Later, a legacy channel-key stream on the same mount: no user identity —
    // the stale entry must NOT be attributed to the previous streamer.
    prisma.streamerKey.findMany.mockResolvedValue([]);
    legacy.verify.mockResolvedValue(true);
    await service.verify("/main", "channel-key-plaintext");
    expect(service.lastAccepted("/main")).toBeNull();
  });
});
