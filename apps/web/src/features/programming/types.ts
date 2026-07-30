import type { PlaylistOrder } from "@aerial/shared";

/**
 * Response DTOs for the programming API (playlists + clockwheels + media). These
 * mirror the control-plane service DTOs 1:1; they live locally in the feature
 * (not @aerial/shared) until another surface needs them — same convention the
 * backend uses for its request schemas.
 */

/** A playlist in list form: its config + how many tracks it holds. */
export interface PlaylistDto {
  id: string;
  name: string;
  order: PlaylistOrder;
  dedupWindowMin: number;
  isJingle: boolean;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One ordered member of a playlist (flattened Track fields). */
export interface PlaylistTrackDto {
  trackId: string;
  position: number;
  title: string;
  artist: string | null;
  fileName: string;
  durationSec: number;
}

/** A playlist with its ordered track membership (GET :id). */
export interface PlaylistDetailDto extends PlaylistDto {
  tracks: PlaylistTrackDto[];
}

/** One resolved slot of a clockwheel (playlist name flattened for the editor). */
export interface ClockSlotDto {
  position: number;
  playlistId: string;
  playlistName: string;
  count: number;
}

/** A clock in list form: its identity + how many slots it holds. */
export interface ClockDto {
  id: string;
  name: string;
  slotCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A clock with its ordered slots (GET :id — the clockwheel editor reads this). */
export interface ClockDetailDto extends ClockDto {
  slots: ClockSlotDto[];
}

/** A media-library track (GET /api/media) surfaced to the track pickers. */
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
