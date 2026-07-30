import type { ShowType } from "@aerial/shared";

/**
 * Response + request DTOs for the schedule feature (shows CRUD + the now/next
 * view). These mirror the control-plane service shapes 1:1
 * (apps/control-plane/src/shows/*); they live locally in the feature — not
 * @aerial/shared — until another surface needs them, the same convention the
 * playlists/clocks features follow. Times are server-local "HH:MM" strings;
 * `daysOfWeek` is 0=Sunday..6=Saturday.
 */

/** A Show as returned by the API (`ShowsService.toDto`). */
export interface ShowDto {
  id: string;
  channelId: string;
  type: ShowType;
  title: string;
  clockId: string | null; // scheduled shows
  ownerId: string | null; // live shows
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  daysOfWeek: number[]; // 0=Sunday..6=Saturday
  dateStart: string | null; // ISO
  dateEnd: string | null; // ISO
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create body for `POST /api/channels/:channelId/shows` — the discriminated
 * union the backend's `createShowSchema` validates. Modelled with `string` dates
 * (not `Date`) because the SPA sends JSON the server coerces; kept distinct from
 * @aerial/shared's `CreateShowInput` (which types the coerced `Date`s).
 */
interface CreateShowBase {
  title: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  dateStart?: string | null;
  dateEnd?: string | null;
  priority?: number;
}
export type CreateShowBody =
  | (CreateShowBase & { type: "scheduled"; clockId: string })
  | (CreateShowBase & { type: "live"; ownerId: string });

/**
 * PATCH body for `PATCH /api/channels/:channelId/shows/:showId`. All fields
 * optional (matches the server's `updateShowSchema`); `type` is intentionally
 * absent (immutable server-side). `dateStart`/`dateEnd` are nullable so a range
 * bound can be cleared.
 */
export interface UpdateShowBody {
  title?: string;
  startTime?: string;
  endTime?: string;
  daysOfWeek?: number[];
  dateStart?: string | null;
  dateEnd?: string | null;
  priority?: number;
  clockId?: string;
  ownerId?: string;
}

/** Flattened resolution for the now/next endpoint (`ScheduleService.summarize`). */
export interface ResolutionSummary {
  kind: "live" | "scheduled" | "default";
  showId: string | null;
  showTitle: string | null;
  clockId: string | null; // scheduled/default
  ownerId: string | null; // live
}

/** The next scheduling boundary after the queried instant. */
export interface NextTransition {
  at: string; // ISO instant of the transition
  boundary: "start" | "end";
  showId: string;
  showTitle: string;
  resolution: ResolutionSummary;
}

/** Response of `GET /api/channels/:channelId/schedule`. */
export interface ScheduleNowNext {
  at: string; // ISO of the queried instant
  now: ResolutionSummary;
  next: NextTransition | null; // null when nothing changes within the next 24h
}

/** Minimal channel row for the channel selector (subset of the channels DTO). */
export interface ChannelSummary {
  id: string;
  name: string;
  slug: string;
}

/** Minimal clock row for the scheduled-show clock picker (subset of the clock DTO). */
export interface ClockSummary {
  id: string;
  name: string;
}

/** Minimal user row for the live-show owner picker (subset of the users DTO). */
export interface UserSummary {
  id: string;
  name: string;
  role: "admin" | "streamer";
}
