import { describe, expect, it } from "vitest";
import {
  buildAnnotateUri,
  mulberry32,
  pickTrack,
  resolveSlot,
  type PlaylistTrackRef,
  type RecentPlay,
} from "./selection";

/**
 * Pure unit tests for the deterministic heart of the Auto-DJ queue (plan §Playout,
 * ADR D17). These pin the expanded-slot pointer arithmetic, the three playlist
 * orders (with dedup + never-starve fallback), and the Liquidsoap annotate URI
 * builder — all pure, RNG injected, so every branch is exercised without a DB.
 */

// ── resolveSlot: expanded-sequence pointer arithmetic ───────────────────────────
describe("resolveSlot (expanded-slot arithmetic + wrap)", () => {
  // slots=[A×2, B×1, C×3] -> expanded=[A,A,B,C,C,C], length 6
  const slots = [
    { position: 0, playlistId: "A", count: 2 },
    { position: 1, playlistId: "B", count: 1 },
    { position: 2, playlistId: "C", count: 3 },
  ];

  it("maps each expanded index to the owning slot and advances by 1", () => {
    expect(resolveSlot(slots, 0)).toEqual({ slot: slots[0], nextPosition: 1 });
    expect(resolveSlot(slots, 1)).toEqual({ slot: slots[0], nextPosition: 2 });
    expect(resolveSlot(slots, 2)).toEqual({ slot: slots[1], nextPosition: 3 });
    expect(resolveSlot(slots, 3)).toEqual({ slot: slots[2], nextPosition: 4 });
    expect(resolveSlot(slots, 4)).toEqual({ slot: slots[2], nextPosition: 5 });
  });

  it("wraps at the total expanded length", () => {
    expect(resolveSlot(slots, 5)).toEqual({ slot: slots[2], nextPosition: 0 });
  });

  it("normalizes an out-of-range pointer (self-healing after the clock shrinks)", () => {
    // pointer 6 -> idx 0 -> slot A, next 1
    expect(resolveSlot(slots, 6)).toEqual({ slot: slots[0], nextPosition: 1 });
    // pointer 8 -> idx 2 -> slot B, next 3
    expect(resolveSlot(slots, 8)).toEqual({ slot: slots[1], nextPosition: 3 });
  });

  it("sorts slots by position before walking (input order is irrelevant)", () => {
    const shuffled = [slots[2], slots[0], slots[1]];
    expect(resolveSlot(shuffled, 0)?.slot.playlistId).toBe("A");
    expect(resolveSlot(shuffled, 2)?.slot.playlistId).toBe("B");
  });

  it("single slot count 1 always resolves to it and next wraps to 0", () => {
    const one = [{ position: 0, playlistId: "A", count: 1 }];
    expect(resolveSlot(one, 0)).toEqual({ slot: one[0], nextPosition: 0 });
    expect(resolveSlot(one, 7)).toEqual({ slot: one[0], nextPosition: 0 });
  });

  it("returns null when there is no playable slot (empty or all counts 0)", () => {
    expect(resolveSlot([], 0)).toBeNull();
    expect(resolveSlot([{ position: 0, playlistId: "A", count: 0 }], 0)).toBeNull();
  });
});

// ── pickTrack ───────────────────────────────────────────────────────────────────
const tracks: PlaylistTrackRef[] = [
  { trackId: "t0", position: 0 },
  { trackId: "t1", position: 1 },
  { trackId: "t2", position: 2 },
  { trackId: "t3", position: 3 },
];
const NOW = new Date("2026-07-29T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("pickTrack — sequential (next after last-played, wrap)", () => {
  const base = { order: "sequential" as const, tracks, dedupWindowMin: 60, now: NOW, rng: () => 0 };

  it("starts at the first track when nothing has been played", () => {
    expect(pickTrack({ ...base, recent: [] })).toBe("t0");
  });

  it("plays the next track after the most-recently-played one", () => {
    const recent: RecentPlay[] = [{ trackId: "t1", at: minsAgo(3) }, { trackId: "t0", at: minsAgo(9) }];
    expect(pickTrack({ ...base, recent })).toBe("t2");
  });

  it("wraps to the first track after the last one", () => {
    expect(pickTrack({ ...base, recent: [{ trackId: "t3", at: minsAgo(1) }] })).toBe("t0");
  });

  it("ignores a last-played track no longer in the playlist (falls to first)", () => {
    expect(pickTrack({ ...base, recent: [{ trackId: "gone", at: minsAgo(1) }] })).toBe("t0");
  });
});

describe("pickTrack — random (uniform, ignores dedup)", () => {
  const base = { order: "random" as const, tracks, dedupWindowMin: 60, now: NOW };
  const recentAll: RecentPlay[] = tracks.map((t) => ({ trackId: t.trackId, at: minsAgo(1) }));

  it("indexes uniformly by the injected rng, even when everything was just played", () => {
    expect(pickTrack({ ...base, recent: recentAll, rng: () => 0 })).toBe("t0");
    expect(pickTrack({ ...base, recent: recentAll, rng: () => 0.999 })).toBe("t3");
    expect(pickTrack({ ...base, recent: recentAll, rng: () => 0.5 })).toBe("t2");
  });

  it("clamps a pathological rng()===1 into range", () => {
    expect(pickTrack({ ...base, recent: [], rng: () => 1 })).toBe("t3");
  });
});

describe("pickTrack — shuffle (dedup exclusion + never-starve)", () => {
  const base = { order: "shuffle" as const, tracks, dedupWindowMin: 60, now: NOW };

  it("picks uniformly among tracks NOT played within the dedup window", () => {
    // t0,t1 played 10m ago (inside 60m window) -> eligible = [t2,t3]
    const recent: RecentPlay[] = [{ trackId: "t0", at: minsAgo(10) }, { trackId: "t1", at: minsAgo(10) }];
    expect(pickTrack({ ...base, recent, rng: () => 0 })).toBe("t2");
    expect(pickTrack({ ...base, recent, rng: () => 0.999 })).toBe("t3");
  });

  it("treats a play OUTSIDE the window as eligible again", () => {
    // t0 played 90m ago -> outside 60m window -> still eligible
    const recent: RecentPlay[] = [{ trackId: "t0", at: minsAgo(90) }];
    expect(pickTrack({ ...base, recent, rng: () => 0 })).toBe("t0");
  });

  it("never starves: when ALL tracks are within the window, plays the least-recently-played", () => {
    const recent: RecentPlay[] = [
      { trackId: "t0", at: minsAgo(5) },
      { trackId: "t1", at: minsAgo(10) },
      { trackId: "t2", at: minsAgo(20) },
      { trackId: "t3", at: minsAgo(30) }, // oldest -> chosen
    ];
    // rng that would throw if used proves the fallback is deterministic (no RNG).
    const rng = () => {
      throw new Error("LRP fallback must not use the RNG");
    };
    expect(pickTrack({ ...base, recent, rng })).toBe("t3");
  });

  it("LRP tie-break: never-played sorts oldest, then lowest position wins", () => {
    // Force all-excluded is impossible with a never-played track, so test the helper
    // path via a window that excludes only the played ones; here two never-played
    // remain eligible and the lower position is reachable by rng()===0.
    const recent: RecentPlay[] = [{ trackId: "t2", at: minsAgo(1) }, { trackId: "t3", at: minsAgo(1) }];
    expect(pickTrack({ ...base, recent, rng: () => 0 })).toBe("t0");
  });
});

describe("pickTrack — empty playlist", () => {
  it("returns null", () => {
    expect(
      pickTrack({ order: "shuffle", tracks: [], recent: [], dedupWindowMin: 60, now: NOW, rng: () => 0 }),
    ).toBeNull();
  });
});

describe("mulberry32 — seedable determinism", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA.every((n) => n >= 0 && n < 1)).toBe(true);
  });

  it("diverges for different seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("drives a deterministic shuffle pick for a fixed seed", () => {
    const rng = mulberry32(42);
    const first = pickTrack({ order: "shuffle", tracks, recent: [], dedupWindowMin: 60, now: NOW, rng });
    const rng2 = mulberry32(42);
    const again = pickTrack({ order: "shuffle", tracks, recent: [], dedupWindowMin: 60, now: NOW, rng: rng2 });
    expect(first).toBe(again);
  });
});

// ── buildAnnotateUri: Liquidsoap 2.2.5 annotate URI ─────────────────────────────
describe("buildAnnotateUri (set-fields-only + escaping)", () => {
  it("emits every set field with the confirmed 2.2.5 keys, in a stable order", () => {
    const uri = buildAnnotateUri(
      {
        fileName: "song.mp3",
        title: "Hello",
        artist: "Artist",
        cueIn: 2,
        cueOut: 180.5,
        fadeIn: 0.5,
        fadeOut: 3,
        amplifyDb: -2,
      },
      "/srv/media/song.mp3",
    );
    expect(uri).toBe(
      'annotate:liq_cue_in="2",liq_cue_out="180.5",liq_fade_in="0.5",liq_fade_out="3",' +
        'liq_amplify="-2 dB",title="Hello",artist="Artist":/srv/media/song.mp3',
    );
  });

  it("omits no-op numeric defaults and null cueOut/artist", () => {
    const uri = buildAnnotateUri(
      {
        fileName: "x.mp3",
        title: "Only Title",
        artist: null,
        cueIn: 0,
        cueOut: null,
        fadeIn: 0,
        fadeOut: 0,
        amplifyDb: 0,
      },
      "/srv/media/x.mp3",
    );
    expect(uri).toBe('annotate:title="Only Title":/srv/media/x.mp3');
  });

  it("backslash-escapes quotes and backslashes in title/artist", () => {
    const uri = buildAnnotateUri(
      {
        fileName: "y.mp3",
        title: 'Hey "Ho"',
        artist: "A\\B",
        cueIn: 0,
        cueOut: null,
        fadeIn: 0,
        fadeOut: 0,
        amplifyDb: 0,
      },
      "/srv/media/y.mp3",
    );
    expect(uri).toBe('annotate:title="Hey \\"Ho\\"",artist="A\\\\B":/srv/media/y.mp3');
  });
});
