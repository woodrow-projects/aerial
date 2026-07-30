/**
 * Fetch layer for the schedule feature — per-channel Show CRUD, the now/next view,
 * and the three pickers the editor needs (channels, clocks, users). Mirrors the
 * playlists/users feature clients: kept in-feature so the whole surface lives
 * together, with a JSON helper that turns any non-2xx into a thrown
 * `Error(message)` so screens surface it verbatim via ErrorNote (e.g. a scheduled
 * show's "unknown clock id", or a streamer's 403 on a mutation).
 *
 * Backend: apps/control-plane/src/shows/* (shows + schedule), plus the open
 * clocks/channels list endpoints and the admin-only users list for the pickers.
 */
import type {
  ChannelSummary,
  ClockSummary,
  CreateShowBody,
  ScheduleNowNext,
  ShowDto,
  UpdateShowBody,
  UserSummary,
} from "./types";

const BASE = "/api";

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

export const scheduleApi = {
  // ── Shows ──
  listShows: (channelId: string) =>
    fetch(`${BASE}/channels/${channelId}/shows`).then(json<ShowDto[]>),

  createShow: (channelId: string, body: CreateShowBody) =>
    fetch(`${BASE}/channels/${channelId}/shows`, JSON_INIT("POST", body)).then(json<ShowDto>),

  updateShow: (channelId: string, showId: string, body: UpdateShowBody) =>
    fetch(`${BASE}/channels/${channelId}/shows/${showId}`, JSON_INIT("PATCH", body)).then(
      json<ShowDto>,
    ),

  deleteShow: (channelId: string, showId: string) =>
    fetch(`${BASE}/channels/${channelId}/shows/${showId}`, { method: "DELETE" }).then(ok),

  // ── Now / next ──
  getSchedule: (channelId: string) =>
    fetch(`${BASE}/channels/${channelId}/schedule`).then(json<ScheduleNowNext>),

  // ── Pickers ──
  listChannels: () => fetch(`${BASE}/channels`).then(json<ChannelSummary[]>),
  listClocks: () => fetch(`${BASE}/clocks`).then(json<ClockSummary[]>),
  listUsers: () => fetch(`${BASE}/users`).then(json<UserSummary[]>),
};
