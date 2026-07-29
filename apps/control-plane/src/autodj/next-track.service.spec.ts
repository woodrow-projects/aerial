import { describe, expect, it, vi } from "vitest";

// ScheduleService lives in a sibling module owned by another agent; it may not be
// on disk during this scoped run. It is only referenced as a DI type here, but mock
// it so the value import can never fail module resolution (cf. clocks.controller.spec
// mocking ../auth/roles). The instance under test is constructed directly with a stub.
vi.mock("../shows/schedule.service", () => ({ ScheduleService: class {} }));

import { NextTrackService } from "./next-track.service";

/**
 * Unit tests for the control-plane-owned deterministic queue (ADR D17). Prisma and
 * ScheduleService are mocked. These pin: resolution -> active-clock mapping (scheduled
 * uses the show's clock; live/default fall to the channel defaultClock — the locked
 * never-silent rule; no clock -> null), the clock-switch pointer reset, the single
 * transaction that logs the decision AND advances the pointer, and fail-soft-to-null.
 */
const NOW = new Date("2026-07-29T12:00:00Z");

interface SlotRow {
  position: number;
  playlistId: string;
  count: number;
  playlist: { id: string; name: string; order: string; dedupWindowMin: number };
}

function slotRow(position: number, playlistId: string, name: string, order = "sequential", count = 1): SlotRow {
  return { position, playlistId, count, playlist: { id: playlistId, name, order, dedupWindowMin: 60 } };
}

function trackRow(trackId: string, position: number, fileName: string, title: string) {
  return {
    trackId,
    position,
    track: {
      fileName,
      title,
      artist: null,
      cueIn: 0,
      cueOut: null,
      fadeIn: 0,
      fadeOut: 0,
      amplifyDb: 0,
    },
  };
}

function mockPrisma() {
  const m: Record<string, unknown> = {
    channel: { findUnique: vi.fn() },
    clock: { findUnique: vi.fn() },
    clockState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    playlistTrack: { findMany: vi.fn().mockResolvedValue([]) },
    playLog: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
  };
  m.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(m));
  return m as never;
}

type PMock = ReturnType<typeof mockPrisma>;
const P = (p: PMock) => p as never as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const tx = (p: PMock) => (p as never as { $transaction: ReturnType<typeof vi.fn> }).$transaction;

function build(overrides?: {
  channel?: unknown;
  resolution?: unknown;
  slots?: SlotRow[];
  clockName?: string;
  clockState?: unknown;
  tracks?: ReturnType<typeof trackRow>[];
  recent?: Array<{ trackId: string; at: Date }>;
}) {
  const prisma = mockPrisma();
  const schedule = { resolve: vi.fn(), activeLiveShowFor: vi.fn() };

  // `?? default` would collapse an explicit `channel: null` (missing-channel case) to
  // the default, so distinguish "not provided" from "provided null" by key presence.
  const channel =
    overrides && "channel" in overrides
      ? overrides.channel
      : { id: "ch1", slug: "main", isActive: true, defaultClockId: "dck" };
  P(prisma).channel.findUnique.mockResolvedValue(channel);
  schedule.resolve.mockResolvedValue(
    overrides?.resolution ?? { kind: "default", clockId: "dck" },
  );
  P(prisma).clock.findUnique.mockResolvedValue({
    id: "ck",
    name: overrides?.clockName ?? "Daytime",
    slots: overrides?.slots ?? [slotRow(0, "pl1", "Currents")],
  });
  if (overrides?.clockState !== undefined) P(prisma).clockState.findUnique.mockResolvedValue(overrides.clockState);
  P(prisma).playlistTrack.findMany.mockResolvedValue(
    overrides?.tracks ?? [trackRow("t1", 0, "a.mp3", "A")],
  );
  if (overrides?.recent) P(prisma).playLog.findMany.mockResolvedValue(overrides.recent);

  const svc = new NextTrackService(prisma, schedule as never);
  svc.now = () => NOW;
  return { svc, prisma, schedule };
}

describe("NextTrackService.next — resolution -> active clock", () => {
  it("scheduled show: uses the show's clockId and logs the show", async () => {
    const { svc, prisma } = build({
      resolution: { kind: "scheduled", show: { id: "s1", title: "Breakfast" }, clockId: "ck-sched" },
    });
    const uri = await svc.next("main");

    expect(uri).toBe('annotate:title="A":/srv/media/a.mp3');
    expect(P(prisma).clock.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ck-sched" } }),
    );
    const logged = P(prisma).playLog.create.mock.calls[0][0].data;
    expect(logged).toMatchObject({ channelId: "ch1", trackId: "t1", playlistId: "pl1", clockId: "ck-sched", slotPosition: 0, showId: "s1" });
    expect(logged.reason).toContain('show "Breakfast"');
    expect(logged.reason).toContain('clock "Daytime" slot 0');
    expect(logged.reason).toContain('playlist "Currents" (sequential)');
  });

  it("live show whose streamer is absent: falls to the channel defaultClock (never-silent)", async () => {
    const { svc, prisma } = build({
      channel: { id: "ch1", slug: "main", isActive: true, defaultClockId: "dck" },
      resolution: { kind: "live", show: { id: "s2", title: "Drive" }, ownerId: "u9" },
    });
    await svc.next("main");

    expect(P(prisma).clock.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "dck" } }));
    const logged = P(prisma).playLog.create.mock.calls[0][0].data;
    expect(logged.showId).toBe("s2");
    expect(logged.reason).toContain('live show "Drive"');
    expect(logged.reason.toLowerCase()).toContain("absent");
  });

  it("unscheduled (default): uses the channel defaultClock, no show", async () => {
    const { svc, prisma } = build({ resolution: { kind: "default", clockId: "dck" } });
    await svc.next("main");
    expect(P(prisma).clock.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "dck" } }));
    const logged = P(prisma).playLog.create.mock.calls[0][0].data;
    expect(logged.showId).toBeNull();
    expect(logged.reason.toLowerCase()).toContain("unscheduled");
  });

  it("no clock at all (default resolution + channel has no defaultClock): returns null, no writes", async () => {
    const { svc, prisma } = build({
      channel: { id: "ch1", slug: "main", isActive: true, defaultClockId: null },
      resolution: { kind: "default", clockId: null },
    });
    expect(await svc.next("main")).toBeNull();
    expect(tx(prisma)).not.toHaveBeenCalled();
    expect(P(prisma).clock.findUnique).not.toHaveBeenCalled();
  });
});

describe("NextTrackService.next — guards", () => {
  it("missing channel -> null, without resolving a schedule", async () => {
    const { svc, prisma, schedule } = build({ channel: null });
    expect(await svc.next("nope")).toBeNull();
    expect(schedule.resolve).not.toHaveBeenCalled();
    expect(tx(prisma)).not.toHaveBeenCalled();
  });

  it("inactive channel -> null", async () => {
    const { svc, schedule } = build({ channel: { id: "ch1", slug: "main", isActive: false, defaultClockId: "dck" } });
    expect(await svc.next("main")).toBeNull();
    expect(schedule.resolve).not.toHaveBeenCalled();
  });

  it("clock with no slots -> null, no writes", async () => {
    const { svc, prisma } = build({ slots: [] });
    expect(await svc.next("main")).toBeNull();
    expect(tx(prisma)).not.toHaveBeenCalled();
  });

  it("empty playlist -> null, no writes", async () => {
    const { svc, prisma } = build({ tracks: [] });
    expect(await svc.next("main")).toBeNull();
    expect(tx(prisma)).not.toHaveBeenCalled();
  });

  it("clock whose slots all have count 0 -> null (no playable expanded index), no writes", async () => {
    const { svc, prisma } = build({ slots: [slotRow(0, "pl1", "Currents", "sequential", 0)] });
    expect(await svc.next("main")).toBeNull();
    expect(P(prisma).playlistTrack.findMany).not.toHaveBeenCalled();
    expect(tx(prisma)).not.toHaveBeenCalled();
  });
});

describe("NextTrackService.next — clock-switch pointer reset", () => {
  it("resets the pointer to 0 when the stored ClockState is for a different clock", async () => {
    const { svc, prisma } = build({
      resolution: { kind: "scheduled", show: { id: "s1", title: "X" }, clockId: "ck-new" },
      slots: [slotRow(0, "pA", "First"), slotRow(1, "pB", "Second")],
      clockState: { channelId: "ch1", clockId: "ck-OLD", position: 1 },
      tracks: [trackRow("tA", 0, "a.mp3", "A")],
    });
    await svc.next("main");

    // pointer forced to 0 -> slot position 0 -> playlist pA -> advance to next position 1
    const logged = P(prisma).playLog.create.mock.calls[0][0].data;
    expect(logged.slotPosition).toBe(0);
    expect(logged.playlistId).toBe("pA");
    expect(P(prisma).clockState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: "ch1" },
        create: { channelId: "ch1", clockId: "ck-new", position: 1 },
        update: { clockId: "ck-new", position: 1 },
      }),
    );
  });

  it("keeps the stored pointer when the clock is unchanged", async () => {
    const { svc, prisma } = build({
      resolution: { kind: "scheduled", show: { id: "s1", title: "X" }, clockId: "ck-same" },
      slots: [slotRow(0, "pA", "First"), slotRow(1, "pB", "Second")],
      clockState: { channelId: "ch1", clockId: "ck-same", position: 1 },
      tracks: [trackRow("tB", 0, "b.mp3", "B")],
    });
    await svc.next("main");
    const logged = P(prisma).playLog.create.mock.calls[0][0].data;
    expect(logged.slotPosition).toBe(1); // used stored pointer 1 -> slot position 1
    expect(logged.playlistId).toBe("pB");
    expect(P(prisma).clockState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { clockId: "ck-same", position: 0 } }), // wraps (total 2)
    );
  });
});

describe("NextTrackService.next — transactionality", () => {
  it("logs the decision AND advances the pointer inside a single transaction", async () => {
    const { svc, prisma } = build();
    await svc.next("main");

    expect(tx(prisma)).toHaveBeenCalledOnce();
    expect(P(prisma).playLog.create).toHaveBeenCalledOnce();
    expect(P(prisma).clockState.upsert).toHaveBeenCalledOnce();
    // The write pair carries the annotate URI on the log row.
    expect(P(prisma).playLog.create.mock.calls[0][0].data.uri).toBe('annotate:title="A":/srv/media/a.mp3');
  });

  it("queries the per-playlist PlayLog lookback for dedup, newest-first", async () => {
    const { svc, prisma } = build({
      slots: [slotRow(0, "plS", "Shuffly", "shuffle")],
      tracks: [trackRow("t1", 0, "a.mp3", "A"), trackRow("t2", 1, "b.mp3", "B")],
      recent: [{ trackId: "t1", at: NOW }],
    });
    svc.rng = () => 0; // eligible = [t2] (t1 deduped) -> index 0
    const uri = await svc.next("main");
    expect(uri).toBe('annotate:title="B":/srv/media/b.mp3');
    expect(P(prisma).playLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channelId: "ch1", playlistId: "plS" }, orderBy: { at: "desc" } }),
    );
    expect(P(prisma).playLog.create.mock.calls[0][0].data.reason).toContain("dedup 60m");
  });
});

describe("NextTrackService.next — fail-soft", () => {
  it("returns null (never throws) when a query rejects", async () => {
    const { svc, prisma } = build();
    P(prisma).channel.findUnique.mockRejectedValue(new Error("db down"));
    await expect(svc.next("main")).resolves.toBeNull();
  });

  it("returns null when the transaction rejects (partial write rolled back)", async () => {
    const { svc, prisma } = build();
    tx(prisma).mockRejectedValue(new Error("tx failed"));
    await expect(svc.next("main")).resolves.toBeNull();
  });
});

describe("NextTrackService.playlog — newest-first decision log", () => {
  const row = {
    id: "l1",
    at: NOW,
    channelId: "ch1",
    trackId: "t1",
    playlistId: "pl1",
    clockId: "ck1",
    slotPosition: 0,
    showId: null,
    reason: "why",
    uri: "annotate:...",
  };

  it("reads newest-first with a default limit of 50", async () => {
    const { svc, prisma } = build();
    P(prisma).playLog.findMany.mockResolvedValue([row]);
    const out = await svc.playlog("ch1", undefined);
    expect(P(prisma).playLog.findMany).toHaveBeenCalledWith({
      where: { channelId: "ch1" },
      orderBy: { at: "desc" },
      take: 50,
    });
    expect(out[0]).toMatchObject({ id: "l1", channelId: "ch1", reason: "why", slotPosition: 0 });
    expect(out[0].at).toBe(NOW.toISOString());
  });

  it("clamps the requested limit into [1, 200]", async () => {
    const { svc, prisma } = build();
    P(prisma).playLog.findMany.mockResolvedValue([]);
    await svc.playlog("ch1", "500");
    expect(P(prisma).playLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
    await svc.playlog("ch1", "0");
    expect(P(prisma).playLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
    await svc.playlog("ch1", "garbage");
    expect(P(prisma).playLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });
});
