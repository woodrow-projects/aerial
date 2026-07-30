/**
 * Fetch layer for the channel-level Auto-DJ controls (plan Phase E) — the endpoints
 * that the core channels client in `src/api.ts` doesn't cover: the clock picker, the
 * two Auto-DJ PATCH fields, and the "why this track" playlog. Kept in-feature and
 * named distinctly from the imported `api` so both can live in one hooks file.
 * The JSON helper turns any non-2xx (e.g. the admin-only 403) into a thrown
 * `Error(message)` so the ErrorNote surfaces it verbatim.
 *
 * Backend: apps/control-plane/src/clocks/* (GET /api/clocks),
 *   apps/control-plane/src/channels/* (PATCH /api/channels/:id — updateChannelSchema
 *   accepts defaultClockId: string|null and enforceSchedule: boolean),
 *   apps/control-plane/src/autodj/playlog.controller.ts (GET :channelId/playlog?limit=).
 */
import type { ChannelDto } from "@aerial/shared";

const BASE = "/api";

/** One clock offered in the default-clock picker (GET /api/clocks returns more; we
 *  only consume id + name). */
export interface ClockSummary {
  id: string;
  name: string;
}

/**
 * A channel plus the two Auto-DJ fields. They live on the backend Channel row and
 * updateChannelSchema, but the shared ChannelDto does not yet surface them — typed
 * here as optional so the controls read current state the moment the API exposes it,
 * defaulting gracefully (null clock / enforce-on) until then.
 */
export interface AutoDjChannel extends ChannelDto {
  defaultClockId?: string | null;
  enforceSchedule?: boolean;
}

/** One "why this track played" decision (PlayLogDto), newest-first from the backend. */
export interface PlayLogEntry {
  id: string;
  at: string; // ISO
  channelId: string;
  trackId: string | null;
  playlistId: string | null;
  clockId: string | null;
  slotPosition: number | null;
  showId: string | null;
  reason: string;
  uri: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const PATCH_JSON = (body: unknown): RequestInit => ({
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const autoDjApi = {
  /** The clockwheels available as a channel default (GET /api/clocks). */
  listClocks: () => fetch(`${BASE}/clocks`).then(json<ClockSummary[]>),

  /** Set (or clear, with null) the Auto-DJ clock that fills unscheduled time (ADR D17). */
  setDefaultClock: (id: string, defaultClockId: string | null) =>
    fetch(`${BASE}/channels/${id}`, PATCH_JSON({ defaultClockId })).then(json<AutoDjChannel>),

  /** Toggle schedule-aware streamer auth (ADR D18). */
  setEnforceSchedule: (id: string, enforceSchedule: boolean) =>
    fetch(`${BASE}/channels/${id}`, PATCH_JSON({ enforceSchedule })).then(json<AutoDjChannel>),

  /** Newest-first playout decisions for the "why this track" view. */
  getPlaylog: (channelId: string, limit?: number) =>
    fetch(
      `${BASE}/channels/${channelId}/playlog${limit != null ? `?limit=${limit}` : ""}`,
    ).then(json<PlayLogEntry[]>),
};
