import { UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InternalController } from "./internal.controller";
import type { StreamKeysService } from "../channels/stream-keys.service";
import type { NowPlayingService } from "../nowplaying/nowplaying.service";
import type { SessionsService } from "../sessions/sessions.service";

/** Baseline tests for the Liquidsoap-facing /internal hooks (ADR D10/D8). */
function deps() {
  const streamKeys = { verify: vi.fn() };
  const nowPlaying = { update: vi.fn(), setLive: vi.fn() };
  const sessions = { open: vi.fn(), close: vi.fn() };
  const controller = new InternalController(
    streamKeys as unknown as StreamKeysService,
    nowPlaying as unknown as NowPlayingService,
    sessions as unknown as SessionsService,
  );
  return { streamKeys, nowPlaying, sessions, controller };
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

  it("status() forwards live state to NowPlayingService.setLive", async () => {
    const { nowPlaying, controller } = deps();
    await controller.status({ slug: "jazz", live: true });
    expect(nowPlaying.setLive).toHaveBeenCalledWith("jazz", true);
  });

  it("status(live=true) opens a stream session (ADR D10 per-stream logging)", async () => {
    const { sessions, controller } = deps();
    await controller.status({ slug: "jazz", live: true });
    expect(sessions.open).toHaveBeenCalledWith("jazz");
    expect(sessions.close).not.toHaveBeenCalled();
  });

  it("status(live=false) closes the stream session", async () => {
    const { sessions, controller } = deps();
    await controller.status({ slug: "jazz", live: false });
    expect(sessions.close).toHaveBeenCalledWith("jazz");
    expect(sessions.open).not.toHaveBeenCalled();
  });
});
