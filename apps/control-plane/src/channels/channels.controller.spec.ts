import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelsController } from "./channels.controller";
import type { ChannelsService } from "./channels.service";
import type { StreamKeysService } from "./stream-keys.service";
import type { NowPlayingService } from "../nowplaying/nowplaying.service";

/**
 * Baseline tests for the channels controller — a delegation layer over
 * ChannelsService / StreamKeysService / NowPlayingService. Asserts each route
 * forwards correctly; the now-playing route's two-step (resolve slug → read) is
 * the one piece of real wiring worth pinning.
 */
function deps() {
  const channels = { list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn() };
  const streamKeys = { create: vi.fn(), list: vi.fn(), revoke: vi.fn() };
  const nowPlaying = { read: vi.fn() };
  const controller = new ChannelsController(
    channels as unknown as ChannelsService,
    streamKeys as unknown as StreamKeysService,
    nowPlaying as unknown as NowPlayingService,
  );
  return { channels, streamKeys, nowPlaying, controller };
}

describe("ChannelsController", () => {
  it("list/create/get/update/remove delegate to ChannelsService", () => {
    const { channels, controller } = deps();
    const body = { name: "Jazz", slug: "jazz" } as never;

    controller.list();
    controller.create(body);
    controller.get("c1");
    controller.update("c1", body);
    controller.remove("c1");

    expect(channels.list).toHaveBeenCalledOnce();
    expect(channels.create).toHaveBeenCalledWith(body);
    expect(channels.get).toHaveBeenCalledWith("c1");
    expect(channels.update).toHaveBeenCalledWith("c1", body);
    expect(channels.remove).toHaveBeenCalledWith("c1");
  });

  it("nowplaying resolves the channel slug then reads that slug's metadata", async () => {
    const { channels, nowPlaying, controller } = deps();
    channels.get.mockResolvedValue({ slug: "jazz" });
    nowPlaying.read.mockReturnValue({ title: "T", artist: "A", live: false, updatedAt: "now" });

    const out = await controller.nowplaying("c1");

    expect(channels.get).toHaveBeenCalledWith("c1");
    expect(nowPlaying.read).toHaveBeenCalledWith("jazz");
    expect(out).toMatchObject({ title: "T", artist: "A" });
  });

  it("stream-key routes delegate to StreamKeysService (create/list by channel, revoke by keyId)", () => {
    const { streamKeys, controller } = deps();

    controller.createKey("c1");
    controller.listKeys("c1");
    controller.revokeKey("k9");

    expect(streamKeys.create).toHaveBeenCalledWith("c1");
    expect(streamKeys.list).toHaveBeenCalledWith("c1");
    expect(streamKeys.revoke).toHaveBeenCalledWith("k9");
  });
});
