import type { PlaylistOrder } from "@aerial/shared";

/**
 * The pure, deterministic core of the control-plane-owned Auto-DJ queue (ADR D17,
 * plan §"Playout engine"). Everything here is side-effect-free — no Prisma, no I/O,
 * RNG injected — so the clock arithmetic, playlist ordering, and the Liquidsoap
 * annotate URI builder are exhaustively unit-testable. `NextTrackService` wires these
 * to the database and the transaction.
 */

// ── Clock pointer arithmetic over the EXPANDED slot sequence ─────────────────────

export interface SlotSpec {
  position: number;
  playlistId: string;
  count: number;
}

export interface SlotResolution {
  slot: SlotSpec;
  /** Pointer to persist for the next call: (currentExpandedIndex + 1) mod total. */
  nextPosition: number;
}

/**
 * Map a clock pointer to the slot that serves the current track, and to the pointer
 * to store next.
 *
 * A clock's slots each repeat `count` times, so the deterministic play sequence is
 * the concatenation of each slot repeated `count` times:
 *
 *   slots = [A×2, B×1, C×3]  ->  expanded = [A, A, B, C, C, C]   (total = 6)
 *
 * `pointer` (ClockState.position) is an index into that expanded sequence. We
 * normalize it modulo the total expanded length (so a pointer left over from a longer
 * clock self-heals), walk the cumulative counts to find the owning slot, and return
 * `(idx + 1) mod total` as the pointer to store — advancing exactly one track and
 * wrapping the whole clock. Returns null when there is nothing to play (no slots, or
 * every count <= 0).
 */
export function resolveSlot(slots: SlotSpec[], pointer: number): SlotResolution | null {
  const ordered = [...slots].sort((a, b) => a.position - b.position);
  const total = ordered.reduce((sum, s) => sum + Math.max(0, s.count), 0);
  if (total <= 0) return null;

  // Safe modulo (handles a pointer >= total, and defensively negatives).
  const idx = ((pointer % total) + total) % total;

  let cumulative = 0;
  for (const slot of ordered) {
    const count = Math.max(0, slot.count);
    if (idx < cumulative + count) {
      return { slot, nextPosition: (idx + 1) % total };
    }
    cumulative += count;
  }
  // Unreachable: idx < total guarantees a hit above. Kept for totality.
  return null;
}

// ── Track selection within a slot's playlist ────────────────────────────────────

export type Rng = () => number; // returns a float in [0, 1)

export interface PlaylistTrackRef {
  trackId: string;
  position: number; // ordinal within the playlist (asc)
}

export interface RecentPlay {
  trackId: string;
  at: Date;
}

export interface PickArgs {
  order: PlaylistOrder;
  tracks: PlaylistTrackRef[]; // ordered by position asc
  recent: RecentPlay[]; // this playlist's PlayLog rows (any order; we sort defensively)
  dedupWindowMin: number;
  now: Date;
  rng: Rng;
}

/**
 * Pick one track from a playlist honoring its `order` (plan §Playout, step 3):
 *   - sequential: the track after the most-recently-played one, wrapping.
 *   - shuffle:    uniform among tracks NOT played within `dedupWindowMin`; if every
 *                 track is inside the window, the least-recently-played one (never
 *                 starves) — a deterministic fallback that does NOT touch the RNG.
 *   - random:     uniform over all tracks, ignoring dedup.
 * Returns null only for an empty playlist.
 */
export function pickTrack(args: PickArgs): string | null {
  const { order, tracks, recent, dedupWindowMin, now, rng } = args;
  if (tracks.length === 0) return null;

  switch (order) {
    case "sequential":
      return pickSequential(tracks, recent);
    case "random":
      return tracks[uniformIndex(rng, tracks.length)].trackId;
    case "shuffle":
      return pickShuffle(tracks, recent, dedupWindowMin, now, rng);
  }
}

/** floor(rng()*n), clamped into [0, n-1] to guard a pathological rng() === 1. */
function uniformIndex(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(rng() * n)));
}

/** Index of the most-recently-played track that is still a member of `tracks`. */
function lastPlayedIndex(tracks: PlaylistTrackRef[], recent: RecentPlay[]): number | null {
  const newestFirst = [...recent].sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const play of newestFirst) {
    const i = tracks.findIndex((t) => t.trackId === play.trackId);
    if (i >= 0) return i;
  }
  return null;
}

function pickSequential(tracks: PlaylistTrackRef[], recent: RecentPlay[]): string {
  const i = lastPlayedIndex(tracks, recent);
  if (i === null) return tracks[0].trackId; // nothing (or nothing still-present) played -> start
  return tracks[(i + 1) % tracks.length].trackId; // next, wrapping
}

function pickShuffle(
  tracks: PlaylistTrackRef[],
  recent: RecentPlay[],
  dedupWindowMin: number,
  now: Date,
  rng: Rng,
): string {
  const cutoff = now.getTime() - dedupWindowMin * 60_000;
  const withinWindow = new Set(recent.filter((r) => r.at.getTime() >= cutoff).map((r) => r.trackId));
  const eligible = tracks.filter((t) => !withinWindow.has(t.trackId));
  if (eligible.length > 0) {
    return eligible[uniformIndex(rng, eligible.length)].trackId;
  }
  return leastRecentlyPlayed(tracks, recent);
}

/**
 * Never-starve fallback: the track played longest ago. A never-played track sorts as
 * infinitely old; ties break on the lower playlist position, so the choice is fully
 * deterministic (no RNG) — important so a saturated dedup window can't wedge the queue.
 */
function leastRecentlyPlayed(tracks: PlaylistTrackRef[], recent: RecentPlay[]): string {
  const lastAt = new Map<string, number>();
  for (const r of recent) {
    const t = r.at.getTime();
    const prev = lastAt.get(r.trackId);
    if (prev === undefined || t > prev) lastAt.set(r.trackId, t);
  }
  const ageOf = (id: string) => (lastAt.has(id) ? lastAt.get(id)! : -Infinity);

  let best = tracks[0];
  for (const t of tracks) {
    const at = ageOf(t.trackId);
    const bestAt = ageOf(best.trackId);
    if (at < bestAt || (at === bestAt && t.position < best.position)) best = t;
  }
  return best.trackId;
}

// ── Liquidsoap annotate URI ──────────────────────────────────────────────────────

export interface TrackMeta {
  fileName: string;
  title: string;
  artist: string | null;
  cueIn: number;
  cueOut: number | null;
  fadeIn: number;
  fadeOut: number;
  amplifyDb: number;
}

/**
 * Build the Liquidsoap 2.2.5 `annotate:` URI the queue hands back to `request.dynamic`
 * (plan §Playout, step 4). Syntax (doc-2.2.5/protocols.html):
 *
 *   annotate:key="v",key2="v2",...:<uri>
 *
 * The `<uri>` after the final colon is the ABSOLUTE media path, unquoted — safe because
 * media filenames are server-generated `[a-z0-9-]+-<hex8>.<ext>` (media.service), so
 * they carry no comma/colon/quote. Quoted values are Liquidsoap string literals: the
 * annotate protocol tokenizes them with the language's own string lexer
 * (src/core/protocols/annotate.ml reuses Liquidsoap_lang.Parser.annotate), so `\` and
 * `"` inside a value MUST be backslash-escaped (backslash first, then quote).
 *
 * Metadata keys, all VERIFIED against Liquidsoap 2.2.5 (do not guess):
 *   liq_cue_in / liq_cue_out   seconds, absolute cue points   (doc-2.2.5/seek.html)
 *   liq_fade_in / liq_fade_out seconds                        (fade.in/out override metadata)
 *   liq_amplify                dB, "<n> dB" suffix form; a bare coefficient is also
 *                              accepted and spaces are ignored — see amplify.ml v2.2.5:
 *                              `Scanf.sscanf s " %f dB"` with default override "liq_amplify".
 *   title / artist             now-playing metadata (ADR D8)
 *
 * "Set fields only": a numeric field at its no-op default (cue/fade 0s, amplify 0 dB)
 * and a null cueOut/artist are omitted, keeping the URI minimal. `title` is always
 * present (it drives now-playing and is a required Track column).
 */
export function buildAnnotateUri(track: TrackMeta, absolutePath: string): string {
  const parts: string[] = [];
  if (track.cueIn > 0) parts.push(`liq_cue_in="${track.cueIn}"`);
  if (track.cueOut != null) parts.push(`liq_cue_out="${track.cueOut}"`);
  if (track.fadeIn > 0) parts.push(`liq_fade_in="${track.fadeIn}"`);
  if (track.fadeOut > 0) parts.push(`liq_fade_out="${track.fadeOut}"`);
  if (track.amplifyDb !== 0) parts.push(`liq_amplify="${track.amplifyDb} dB"`);
  parts.push(`title="${escapeAnnotate(track.title)}"`);
  if (track.artist != null && track.artist !== "") parts.push(`artist="${escapeAnnotate(track.artist)}"`);
  return `annotate:${parts.join(",")}:${absolutePath}`;
}

/** Escape a value for a quoted Liquidsoap string literal: backslash first, then quote. */
function escapeAnnotate(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ── Seedable RNG (deterministic tests) ──────────────────────────────────────────

/**
 * mulberry32 — a small, fast, seedable PRNG. Production selection uses `Math.random`;
 * tests inject a seeded generator so a shuffle/random pick is reproducible.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
