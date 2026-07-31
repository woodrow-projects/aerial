import { UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InternalController } from "./internal.controller";
import type { NowPlayingService } from "../nowplaying/nowplaying.service";
import type { SessionsService } from "../sessions/sessions.service";
import type { StreamerAuthService } from "../streamer-keys/streamer-auth.service";
import type { NextTrackService } from "../autodj/next-track.service";

/** Tests for the Liquidsoap-facing /internal hooks (ADR D8/D10/D17/D18). */
function deps() {
  const streamerAuth = { verify: vi.fn(), lastAccepted: vi.fn().mockReturnValue(null) };
  const nowPlaying = { update: vi.fn(), setLive: vi.fn() };
  const sessions = { open: vi.fn(), close: vi.fn() };
  const nextTrack = { next: vi.fn() };
  const controller = new InternalController(
    streamerAuth as unknown as StreamerAuthService,
    nowPlaying as unknown as NowPlayingService,
    sessions as unknown as SessionsService,
    nextTrack as unknown as NextTrackService,
  );
  return { streamerAuth, nowPlaying, sessions, nextTrack, controller };
}

function fakeReply() {
  const reply = { status: vi.fn() };
  reply.status.mockReturnValue(reply);
  return reply;
}

describe("InternalController.auth (schedule-aware harbor source auth, ADR D18)", () => {
  it("accepts when user is 'source' and StreamerAuthService verifies, forwarding the address", async () => {
    const { streamerAuth, controller } = deps();
    streamerAuth.verify.mockResolvedValue({ ok: true, userId: "u1" });

    await expect(
      controller.auth({ user: "source", password: "k", mount: "/jazz", address: "203.0.113.9" }),
    ).resolves.toEqual({ allowed: true });
    expect(streamerAuth.verify).toHaveBeenCalledWith("/jazz", "k", "203.0.113.9");
  });

  it("rejects when verification fails", async () => {
    const { streamerAuth, controller } = deps();
    streamerAuth.verify.mockResolvedValue({ ok: false });
    await expect(controller.auth({ user: "source", password: "bad", mount: "/jazz" })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects a non-'source' user without consulting the key store", async () => {
    const { streamerAuth, controller } = deps();
    await expect(controller.auth({ user: "admin", password: "k", mount: "/jazz" })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(streamerAuth.verify).not.toHaveBeenCalled();
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

  it("status(live=true) opens a session with source IP and the auth-established streamer id", async () => {
    const { streamerAuth, sessions, controller } = deps();
    streamerAuth.lastAccepted.mockReturnValue({ userId: "u1", address: "203.0.113.9" });

    await controller.status({ slug: "jazz", live: true, address: "203.0.113.9" });

    expect(streamerAuth.lastAccepted).toHaveBeenCalledWith("/jazz");
    expect(sessions.open).toHaveBeenCalledWith("jazz", "203.0.113.9", "u1");
    expect(sessions.close).not.toHaveBeenCalled();
  });

  it("status(live=true) tolerates no auth record (legacy key path: null streamer)", async () => {
    const { sessions, controller } = deps();
    await controller.status({ slug: "jazz", live: true });
    expect(sessions.open).toHaveBeenCalledWith("jazz", null, null);
  });

  it("status(live=false) closes the stream session", async () => {
    const { sessions, controller } = deps();
    await controller.status({ slug: "jazz", live: false });
    expect(sessions.close).toHaveBeenCalledWith("jazz");
    expect(sessions.open).not.toHaveBeenCalled();
  });
});

describe("InternalController.nextTrack (Auto-DJ pull, ADR D17)", () => {
  it("returns the annotate URI with 200 when a track is available", async () => {
    const { nextTrack, controller } = deps();
    const reply = fakeReply();
    nextTrack.next.mockResolvedValue('annotate:title="T":/srv/media/a.mp3');

    await expect(controller.nextTrack({ slug: "jazz" }, reply)).resolves.toBe(
      'annotate:title="T":/srv/media/a.mp3',
    );
    expect(nextTrack.next).toHaveBeenCalledWith("jazz");
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  it("returns 204 with an empty body when nothing is playable (engine falls to silence)", async () => {
    const { nextTrack, controller } = deps();
    const reply = fakeReply();
    nextTrack.next.mockResolvedValue(null);

    await expect(controller.nextTrack({ slug: "jazz" }, reply)).resolves.toBe("");
    expect(reply.status).toHaveBeenCalledWith(204);
  });
});

describe("status connect — address source of truth (review finding)", () => {
  it("prefers the server-side accepted address over the template-replayed one", async () => {
    const { streamerAuth, sessions, controller } = deps();
    streamerAuth.lastAccepted.mockReturnValue({ userId: "u1", address: "198.51.100.1" });

    // The engine's shared ref got clobbered by a concurrent auth attempt:
    await controller.status({ slug: "jazz", live: true, address: "203.0.113.66" });

    expect(sessions.open).toHaveBeenCalledWith("jazz", "198.51.100.1", "u1");
  });
});
