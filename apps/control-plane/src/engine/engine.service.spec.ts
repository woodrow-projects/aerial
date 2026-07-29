import { EventEmitter } from "node:events";
import type { Channel } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineService } from "./engine.service";
import { buildLiquidsoapScript, type LiquidsoapParams } from "./liq-template";

// Hoisted so the vi.mock factories (which are hoisted above imports) can see them.
const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: (...a: unknown[]) => mocks.spawn(...a) }));
vi.mock("node:fs", () => ({
  mkdirSync: (...a: unknown[]) => mocks.mkdirSync(...a),
  writeFileSync: (...a: unknown[]) => mocks.writeFileSync(...a),
  readFileSync: (...a: unknown[]) => mocks.readFileSync(...a),
  existsSync: (...a: unknown[]) => mocks.existsSync(...a),
}));

/** A stand-in for a spawned Liquidsoap child process — no real process. */
function fakeProc(): EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn>; stdout: { on: () => void }; stderr: { on: () => void } } {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    kill: ReturnType<typeof vi.fn>;
    stdout: { on: () => void };
    stderr: { on: () => void };
  };
  proc.pid = 4321;
  proc.kill = vi.fn();
  proc.stdout = { on: () => {} };
  proc.stderr = { on: () => {} };
  return proc;
}

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "c1",
    name: "Main",
    slug: "main",
    mount: "/main",
    isActive: true,
    deliveryMode: "hls",
    harborPort: 8100,
    hlsBitrates: "[48,96,192]", // stored as JSON text (SQLite has no scalar lists)
    icecastBitrate: 128,
    createdAt: new Date("2026-06-18T00:00:00Z"),
    updatedAt: new Date("2026-06-18T00:00:00Z"),
    ...overrides,
  };
}

describe("EngineService buildParams column decoding", () => {
  it("decodes the stored deliveryMode and hlsBitrates columns for the Liquidsoap template", () => {
    const svc = new EngineService(undefined as never);
    const params = (
      svc as unknown as { buildParams: (c: Channel) => LiquidsoapParams }
    ).buildParams(makeChannel());
    expect(params.deliveryMode).toBe("hls");
    expect(params.hlsBitrates).toEqual([48, 96, 192]);
  });

  it("fails loudly on a corrupt hlsBitrates column instead of templating garbage", () => {
    const svc = new EngineService(undefined as never);
    expect(() =>
      (svc as unknown as { buildParams: (c: Channel) => LiquidsoapParams }).buildParams(
        makeChannel({ hlsBitrates: "oops" }),
      ),
    ).toThrow(/hlsBitrates/);
  });
});

describe("EngineService syncChannel — restart only when the script changes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.spawn.mockReset().mockImplementation(() => fakeProc());
    mocks.mkdirSync.mockReset();
    mocks.writeFileSync.mockReset();
    mocks.readFileSync.mockReset();
    mocks.existsSync.mockReset().mockReturnValue(false);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  /** Bring a channel to the running state and return its live fake process. */
  function startRunning(svc: EngineService, channel: Channel) {
    svc.syncChannel(channel); // not running yet → restart path schedules startChannel
    vi.advanceTimersByTime(500);
    return mocks.spawn.mock.results.at(-1)!.value as ReturnType<typeof fakeProc>;
  }

  it("skips the restart entirely when the regenerated script is identical", () => {
    const svc = new EngineService(undefined as never);
    const channel = makeChannel({ isActive: true });
    const proc = startRunning(svc, channel);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    // Same config → same script text → no kill, no re-spawn (kills the audio gap).
    svc.syncChannel(channel);
    vi.advanceTimersByTime(1000);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("restarts when the generated script text actually changes", () => {
    const svc = new EngineService(undefined as never);
    const channel = makeChannel({ isActive: true, deliveryMode: "hls" });
    const proc1 = startRunning(svc, channel);

    // deliveryMode hls → both changes the script (adds the Icecast output block).
    svc.syncChannel(makeChannel({ isActive: true, deliveryMode: "both" }));
    expect(proc1.kill).toHaveBeenCalled(); // old process torn down
    vi.advanceTimersByTime(500);
    expect(mocks.spawn).toHaveBeenCalledTimes(2); // new process spawned
  });

  it("stops (does not restart) when the channel goes inactive", () => {
    const svc = new EngineService(undefined as never);
    const proc = startRunning(svc, makeChannel({ isActive: true }));

    svc.syncChannel(makeChannel({ isActive: false }));
    expect(proc.kill).toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(mocks.spawn).toHaveBeenCalledTimes(1); // no re-spawn
  });

  it("restarts on the inactive→active transition even if the script is unchanged", () => {
    const svc = new EngineService(undefined as never);
    startRunning(svc, makeChannel({ isActive: true }));
    svc.syncChannel(makeChannel({ isActive: false })); // stop
    svc.syncChannel(makeChannel({ isActive: true })); // reactivate
    vi.advanceTimersByTime(500);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });
});

describe("EngineService onApplicationBootstrap — seed running-script cache from disk", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.spawn.mockReset().mockImplementation(() => fakeProc());
    mocks.mkdirSync.mockReset();
    mocks.writeFileSync.mockReset();
    mocks.readFileSync.mockReset();
    mocks.existsSync.mockReset().mockReturnValue(false);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("seeds the cache from an identical on-disk .liq so boot does not rewrite it, then a no-op sync skips the restart", () => {
    const channel = makeChannel({ isActive: true });
    const prisma = { channel: { findMany: vi.fn().mockResolvedValue([channel]) } };
    const svc = new EngineService(prisma as never);

    // The .liq already on disk exactly matches what the generator would emit now.
    const params = (svc as unknown as { buildParams: (c: Channel) => LiquidsoapParams }).buildParams(channel);
    const onDisk = buildLiquidsoapScript(params);
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(onDisk);

    return svc.onApplicationBootstrap().then(() => {
      // Seeded → identical → no rewrite, but the process is still spawned.
      expect(mocks.writeFileSync).not.toHaveBeenCalled();
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
      const proc = mocks.spawn.mock.results.at(-1)!.value as ReturnType<typeof fakeProc>;

      // Cache was seeded, so an unchanged sync skips the restart.
      svc.syncChannel(channel);
      vi.advanceTimersByTime(1000);
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
      expect(proc.kill).not.toHaveBeenCalled();
    });
  });
});
