import type { CreateTrackMetaInput } from "@aerial/shared";

/**
 * Media-library fetch layer — the same hand-rolled `fetch` idiom as `src/api.ts`,
 * kept local to the feature (this screen ships after the shared client and never
 * edits it). Reads are open to any operator; upload/patch/delete are admin-only
 * server-side (403 for streamers), surfaced through the ErrorNote pattern.
 *
 * Endpoints (apps/control-plane/src/media/media.controller.ts):
 *   GET    /api/media          → TrackDto[]
 *   POST   /api/media          → TrackDto      (multipart; 415 bad ext, 422 ffprobe, 413 too large)
 *   PATCH  /api/media/:id       → TrackDto      (partial metadata)
 *   DELETE /api/media/:id       → 204
 */

const BASE = "/api";

/** A media-library track as returned by the control plane (media.service TrackDto). */
export interface TrackDto {
  id: string;
  fileName: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationSec: number;
  cueIn: number;
  cueOut: number | null;
  fadeIn: number;
  fadeOut: number;
  amplifyDb: number;
  createdAt: string;
  updatedAt: string;
}

/** Error carrying the HTTP status so the upload UI can distinguish 415/422/413 per file. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, body.message ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function expectOk(res: Response): Promise<void> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, body.message ?? `${res.status} ${res.statusText}`);
  }
}

export const listTracks = (): Promise<TrackDto[]> => fetch(`${BASE}/media`).then(json<TrackDto[]>);

/**
 * Upload one file. The controller reads the first multipart file part via
 * `req.file()`, so the form-field name is not validated — we send it as `file`.
 */
export const uploadTrack = (file: File): Promise<TrackDto> => {
  const form = new FormData();
  form.append("file", file, file.name);
  return fetch(`${BASE}/media`, { method: "POST", body: form }).then(json<TrackDto>);
};

export const updateTrack = (id: string, input: CreateTrackMetaInput): Promise<TrackDto> =>
  fetch(`${BASE}/media/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then(json<TrackDto>);

export const deleteTrack = (id: string): Promise<void> =>
  fetch(`${BASE}/media/${id}`, { method: "DELETE" }).then(expectOk);
