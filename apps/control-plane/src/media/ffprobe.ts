import { execFile } from "node:child_process";

/**
 * Media metadata extracted from a stored file via `ffprobe` (ADR D17, plan Phase A).
 * `ffprobe` ships in the control-plane image; we shell out and read its JSON.
 */
export interface ProbeResult {
  durationSec: number;
  title: string | null;
  artist: string | null;
  album: string | null;
}

// The binary name; overridable for unusual images. Kept local (not env.ts) — this
// module owns the ffprobe integration.
const FFPROBE_BIN = process.env.FFPROBE_BIN ?? "ffprobe";

/**
 * Probe a stored media file for duration + title/artist/album tags. Rejects if the
 * process fails, the output is not JSON, or no usable duration is present — the
 * caller maps that to a 422 and unlinks the just-uploaded file.
 */
export async function ffprobe(filePath: string): Promise<ProbeResult> {
  const stdout = await run(filePath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("ffprobe returned invalid JSON");
  }

  const format = (parsed as { format?: { duration?: unknown; tags?: unknown } }).format ?? {};
  const durationSec = Number(format.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("ffprobe could not determine media duration");
  }

  const tags = normalizeTags(format.tags);
  return {
    durationSec,
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
  };
}

/** Wrap execFile in a promise. `-show_format` yields `format.duration` + `format.tags`. */
function run(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      FFPROBE_BIN,
      ["-v", "quiet", "-print_format", "json", "-show_format", filePath],
      { maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout));
      },
    );
  });
}

/**
 * ffprobe tag keys vary by container casing (MP3 `title`, FLAC/Ogg `TITLE`), so match
 * case-insensitively. Empty/whitespace-only values are treated as absent (null) so the
 * caller's filename fallback kicks in.
 */
function normalizeTags(raw: unknown): { title: string | null; artist: string | null; album: string | null } {
  const lower: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string") lower[key.toLowerCase()] = value;
    }
  }
  const pick = (key: string): string | null => {
    const v = lower[key];
    return v && v.trim() ? v : null;
  };
  return { title: pick("title"), artist: pick("artist"), album: pick("album") };
}
