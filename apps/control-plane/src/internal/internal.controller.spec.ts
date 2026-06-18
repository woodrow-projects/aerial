import { UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InternalController } from "./internal.controller";
import type { StreamKeysService } from "../channels/stream-keys.service";
import type { NowPlayingService } from "../nowplaying/nowplaying.service";

/** Baseline tests for the Liquidsoap-facing /internal hooks (ADR D10/D8). */
function deps() {
  const streamKeys = { verify: vi.fn() };
  const nowPlaying = { update: vi.fn(), setLive: vi.fn() };
  const controller = new InternalController(
    streamKeys as unknown as StreamKeysService,
    nowPlaying as unknown as NowPlayingService,
  );
  return { streamKeys, nowPlaying, controller };
}

describe("InternalController.auth (harbor source auth)", () => {
  it("accepts when user is 'source' and the stream key verifies for the mount", async () => {
    const { streamKeys, controller } = deps();
    streamKeys.verify.mockResolvedValue(true);

    await expect(controller.auth({ user: "source", password: "k", mount: "/jazz" })).resolves.toEqual({
      allowed: true,
    });
    expect(streamKeys.verify).toHaveBeenCalledWith("/jazz", "k");
  });

  it("rejects when the stream key does not verify", async () => {
    const { streamKeys, controller } = deps();
    streamKeys.verify.mockResolvedValue(false);
    await expect(controller.auth({ user: "source", password: "bad", mount: "/jazz" })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects a non-'source' user without consulting the key store", async () => {
    const { streamKeys, controller } = deps();
    await expect(controller.auth({ user: "admin", password: "k", mount: "/jazz" })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(streamKeys.verify).not.toHaveBeenCalled();
  });
});

describe("InternalController metadata/status hooks", () => {
  it("metadata() forwards title/artist to NowPlayingService.update", () => {
    const { nowPlaying, controller } = deps();
    controller.metadata({ slug: "jazz", title: "T", artist: "A" });
    expect(nowPlaying.update).toHaveBeenCalledWith("jazz", "T", "A");
  });

  it("status() forwards live state to NowPlayingService.setLive", () => {
    const { nowPlaying, controller } = deps();
    controller.status({ slug: "jazz", live: true });
    expect(nowPlaying.setLive).toHaveBeenCalledWith("jazz", true);
  });
});
