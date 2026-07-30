import type { CreateTrackMetaInput } from "@aerial/shared";
import type { TrackDto } from "./api";

/**
 * Pure helpers for the media library: duration formatting, the sequential
 * upload-queue state machine, and metadata form <-> PATCH payload mapping. All
 * side-effect-free so the interesting behaviour is unit-tested here (ADR D14),
 * leaving the components thin.
 */

/** Format a duration in seconds as `m:ss` (or `h:mm:ss` past an hour). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

// ── Upload queue ────────────────────────────────────────────────────────────────

export type UploadStatus = "pending" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  name: string;
  file: File;
  status: UploadStatus;
  /** Human-readable failure reason when `status === "error"`. */
  error?: string;
}

/** One pending queue item per selected file, preserving selection order. */
export function buildQueue(files: File[]): UploadItem[] {
  return files.map((file, index) => ({
    id: `${index}:${file.name}`,
    name: file.name,
    file,
    status: "pending" as const,
  }));
}

/** Immutably set one item's status (+ optional error), leaving the rest untouched. */
export function setItemStatus(
  items: UploadItem[],
  id: string,
  status: UploadStatus,
  error?: string,
): UploadItem[] {
  return items.map((item) =>
    item.id === id ? { ...item, status, error: status === "error" ? error : undefined } : item,
  );
}

/** The next item still waiting to upload, or undefined when the queue is drained. */
export function firstPending(items: UploadItem[]): UploadItem | undefined {
  return items.find((item) => item.status === "pending");
}

/** A friendly, per-file message for an upload failure (415 extension, 422 ffprobe, ...). */
export function describeUploadError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { status?: number; message?: string };
    if (e.message) return e.message;
    if (e.status === 415) return "Unsupported file type.";
    if (e.status === 422) return "Could not read audio metadata.";
    if (e.status === 413) return "File is too large.";
  }
  return "Upload failed.";
}

// ── Metadata form <-> PATCH payload ─────────────────────────────────────────────

/** String-valued mirror of the editable metadata (what the inputs bind to). */
export interface TrackMetaForm {
  title: string;
  artist: string;
  album: string;
  cueIn: string;
  cueOut: string;
  fadeIn: string;
  fadeOut: string;
  amplifyDb: string;
}

const num = (n: number): string => String(n);
const blankToNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** Seed the edit form from a track; null artist/album/cueOut render as empty fields. */
export function formFromTrack(track: TrackDto): TrackMetaForm {
  return {
    title: track.title,
    artist: track.artist ?? "",
    album: track.album ?? "",
    cueIn: num(track.cueIn),
    cueOut: track.cueOut === null ? "" : num(track.cueOut),
    fadeIn: num(track.fadeIn),
    fadeOut: num(track.fadeOut),
    amplifyDb: num(track.amplifyDb),
  };
}

/**
 * Build the PATCH payload from the form: trim the title, blank text fields clear to
 * null, and cue/fade/amplify parse to numbers (validated against createTrackMetaSchema
 * by the caller before sending).
 */
export function buildTrackMetaPayload(form: TrackMetaForm): CreateTrackMetaInput {
  return {
    title: form.title.trim(),
    artist: blankToNull(form.artist),
    album: blankToNull(form.album),
    cueIn: Number(form.cueIn),
    cueOut: form.cueOut.trim() === "" ? null : Number(form.cueOut),
    fadeIn: Number(form.fadeIn),
    fadeOut: Number(form.fadeOut),
    amplifyDb: Number(form.amplifyDb),
  };
}

/** Number fields on the edit form, each with a one-line explanation of its playout effect. */
export const PLAYOUT_FIELDS = [
  {
    key: "cueIn",
    label: "Cue in (s)",
    help: "Seconds skipped at the start before playout begins.",
  },
  {
    key: "cueOut",
    label: "Cue out (s)",
    help: "Point (seconds from start) to stop playout; blank plays to the end.",
  },
  {
    key: "fadeIn",
    label: "Fade in (s)",
    help: "Seconds to ramp the volume up as the track starts.",
  },
  {
    key: "fadeOut",
    label: "Fade out (s)",
    help: "Seconds to ramp the volume down into the next track.",
  },
  {
    key: "amplifyDb",
    label: "Amplify (dB)",
    help: "Gain trim applied on playout to even out loudness (may be negative).",
  },
] as const satisfies ReadonlyArray<{
  key: keyof TrackMetaForm;
  label: string;
  help: string;
}>;
