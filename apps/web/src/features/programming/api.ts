/**
 * Fetch layer for the programming feature — playlists, clockwheels, and the media
 * library the track/slot pickers read. Mirrors `src/api.ts` / the users feature's
 * local client, kept in-feature so the whole surface lives together. The JSON
 * helper turns any non-2xx into a thrown `Error(message)` so screens surface it
 * verbatim (e.g. the 409 that names the clocks blocking a playlist delete).
 *
 * Backend: apps/control-plane/src/{playlists,clocks,media}/*.
 */
import type {
  ClockSlotInput,
  CreateClockInput,
  CreatePlaylistInput,
  UpdatePlaylistInput,
} from "@aerial/shared";
import type {
  ClockDetailDto,
  ClockDto,
  PlaylistDetailDto,
  PlaylistDto,
  TrackDto,
} from "./types";

const BASE = "/api";

/** PATCH body for a clock — name and/or a full slot-array replace (local to the
 *  clocks module server-side; typed here where the SPA needs it). */
export interface UpdateClockInput {
  name?: string;
  slots?: ClockSlotInput[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** For 204 endpoints (delete): throw the server message on failure, else void. */
async function ok(res: Response): Promise<void> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${res.status} ${res.statusText}`);
  }
}

const JSON_INIT = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const programmingApi = {
  // ── Playlists ──
  listPlaylists: () => fetch(`${BASE}/playlists`).then(json<PlaylistDto[]>),

  getPlaylist: (id: string) => fetch(`${BASE}/playlists/${id}`).then(json<PlaylistDetailDto>),

  createPlaylist: (input: CreatePlaylistInput) =>
    fetch(`${BASE}/playlists`, JSON_INIT("POST", input)).then(json<PlaylistDto>),

  updatePlaylist: (id: string, input: UpdatePlaylistInput) =>
    fetch(`${BASE}/playlists/${id}`, JSON_INIT("PATCH", input)).then(json<PlaylistDto>),

  /** PUT the full ordered membership — array order IS the position (atomic replace). */
  setPlaylistTracks: (id: string, trackIds: string[]) =>
    fetch(`${BASE}/playlists/${id}/tracks`, JSON_INIT("PUT", { trackIds })).then(
      json<PlaylistDetailDto>,
    ),

  /** 409 (thrown, message names the clocks) if the playlist is wired into a clock slot. */
  deletePlaylist: (id: string) => fetch(`${BASE}/playlists/${id}`, { method: "DELETE" }).then(ok),

  // ── Clocks ──
  listClocks: () => fetch(`${BASE}/clocks`).then(json<ClockDto[]>),

  getClock: (id: string) => fetch(`${BASE}/clocks/${id}`).then(json<ClockDetailDto>),

  createClock: (input: CreateClockInput) =>
    fetch(`${BASE}/clocks`, JSON_INIT("POST", input)).then(json<ClockDetailDto>),

  updateClock: (id: string, input: UpdateClockInput) =>
    fetch(`${BASE}/clocks/${id}`, JSON_INIT("PATCH", input)).then(json<ClockDetailDto>),

  /** 409 (thrown, message names the referrers) if a channel default-clock or show uses it. */
  deleteClock: (id: string) => fetch(`${BASE}/clocks/${id}`, { method: "DELETE" }).then(ok),

  // ── Media library (track pickers) ──
  listMedia: () => fetch(`${BASE}/media`).then(json<TrackDto[]>),
};
