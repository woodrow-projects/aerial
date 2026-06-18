import { beforeEach, describe, expect, it, vi } from "vitest";

// Avoid touching the real filesystem; capture what would be written.
const mkdirSync = vi.fn();
const writeFileSync = vi.fn();
vi.mock("node:fs", () => ({ mkdirSync: (...a: unknown[]) => mkdirSync(...a), writeFileSync: (...a: unknown[]) => writeFileSync(...a) }));

import { NowPlayingService } from "./nowplaying.service";

describe("NowPlayingService (ADR D8)", () => {
  let svc: NowPlayingService;
  beforeEach(() => {
    mkdirSync.mockReset();
    writeFileSync.mockReset();
    svc = new NowPlayingService();
  });

  it("defaults an unknown channel to empty, not-live metadata", () => {
    const np = svc.read("ghost");
    expect(np).toMatchObject({ title: "", artist: "", live: false });
    expect(typeof np.updatedAt).toBe("string");
  });

  it("update() records title/artist and persists nowplaying.json under the channel's HLS dir", () => {
    svc.update("jazz", "Blue in Green", "Miles Davis");

    expect(svc.read("jazz")).toMatchObject({ title: "Blue in Green", artist: "Miles Davis", live: false });
    const [path, contents] = writeFileSync.mock.calls.at(-1) as [string, string];
    expect(path).toMatch(/jazz\/nowplaying\.json$/);
    expect(JSON.parse(contents)).toMatchObject({ title: "Blue in Green", artist: "Miles Davis" });
  });

  it("setLive() toggles live state independently of track metadata", () => {
    svc.update("jazz", "Track", "Artist");
    svc.setLive("jazz", true);
    expect(svc.isLive("jazz")).toBe(true);
    // metadata preserved across the live toggle
    expect(svc.read("jazz")).toMatchObject({ title: "Track", artist: "Artist", live: true });

    svc.setLive("jazz", false);
    expect(svc.isLive("jazz")).toBe(false);
  });

  it("swallows filesystem errors so a write failure never breaks the hook", () => {
    writeFileSync.mockImplementation(() => {
      throw new Error("disk full");
    });
    expect(() => svc.update("jazz", "t", "a")).not.toThrow();
    // in-memory state still updated despite the persist failure
    expect(svc.read("jazz").title).toBe("t");
  });
});
