import { describe, expect, it, vi } from "vitest";
import { ChannelsService } from "./channels.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { EngineService } from "../engine/engine.service";
import type { NowPlayingService } from "../nowplaying/nowplaying.service";
import type { CdnService } from "../cdn/cdn.service";

/**
 * Regression (review finding): update() silently dropped defaultClockId and
 * enforceSchedule — the SPA's Auto-DJ channel controls no-op'd. Pins that both
 * persist, including the tri-state defaultClockId (null = clear, undefined =
 * unchanged — a `?? undefined` collapse would silently eat the clear).
 */
const CHANNEL = {
  id: "c1",
  name: "Main",
  slug: "main",
  mount: "/main",
  isActive: true,
  deliveryMode: "both",
  harborPort: 8100,
  hlsBitrates: "[64,128]",
  icecastBitrate: 128,
  defaultClockId: "clk-1",
  enforceSchedule: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function build() {
  const prisma = {
    channel: {
      findUnique: vi.fn().mockResolvedValue(CHANNEL),
      update: vi.fn().mockResolvedValue(CHANNEL),
    },
  };
  const engine = { syncChannel: vi.fn() };
  const nowPlaying = { isLive: vi.fn().mockReturnValue(false) };
  const cdn = { hlsBaseUrl: vi.fn().mockReturnValue(null) };
  const svc = new ChannelsService(
    prisma as unknown as PrismaService,
    engine as unknown as EngineService,
    nowPlaying as unknown as NowPlayingService,
    cdn as unknown as CdnService,
  );
  return { prisma, engine, svc };
}

describe("ChannelsService.update — Auto-DJ fields (D17/D18)", () => {
  it("persists defaultClockId and enforceSchedule", async () => {
    const { prisma, svc } = build();
    await svc.update("c1", { defaultClockId: "clk-2", enforceSchedule: false });
    expect(prisma.channel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ defaultClockId: "clk-2", enforceSchedule: false }),
      }),
    );
  });

  it("defaultClockId: null clears the clock (tri-state, not collapsed to undefined)", async () => {
    const { prisma, svc } = build();
    await svc.update("c1", { defaultClockId: null });
    expect(prisma.channel.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ defaultClockId: null }) }),
    );
  });

  it("omitting both leaves them undefined (unchanged)", async () => {
    const { prisma, svc } = build();
    await svc.update("c1", { name: "Renamed" });
    const data = prisma.channel.update.mock.calls[0]![0].data;
    expect(data.defaultClockId).toBeUndefined();
    expect(data.enforceSchedule).toBeUndefined();
  });
});

describe("ChannelsService DTO — Auto-DJ fields surfaced (review finding)", () => {
  it("returns defaultClockId and enforceSchedule so the UI can display state", async () => {
    const { svc } = build();
    const dto = await svc.update("c1", {});
    expect(dto.defaultClockId).toBe("clk-1");
    expect(dto.enforceSchedule).toBe(true);
  });
});
