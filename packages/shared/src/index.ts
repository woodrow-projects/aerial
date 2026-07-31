import { z } from "zod";

/**
 * Shared contracts between the control-plane API, the SPA, and the Liquidsoap
 * engine hooks. These zod schemas are the single source of truth for types and
 * runtime validation (control plane validates inbound; SPA infers types).
 */

// ── Channels ──────────────────────────────────────────────────────────────────

/** Lowercase, url-safe slug — also used as the HLS path prefix and Icecast mount. */
export const slugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case (a-z, 0-9, hyphens)");

/** HLS rendition bitrates (kbps). Defaults give adaptive HE-AAC 64k + AAC-LC 128k. */
export const hlsBitratesSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(4)
  .default([64, 128]);

/** Which outputs a channel emits (ADR D2). `both` = HLS + Icecast. */
export const DELIVERY_MODES = ["hls", "icecast", "both"] as const;
export const deliveryModeSchema = z.enum(DELIVERY_MODES);
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const createChannelSchema = z.object({
  name: z.string().min(1).max(120),
  slug: slugSchema,
  deliveryMode: deliveryModeSchema.default("both"),
  hlsBitrates: hlsBitratesSchema.optional(),
  icecastBitrate: z.number().int().positive().default(128).optional(),
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  deliveryMode: deliveryModeSchema.optional(),
  hlsBitrates: hlsBitratesSchema.optional(),
  icecastBitrate: z.number().int().positive().optional(),
  // The Auto-DJ clock that fills unscheduled time (ADR D17). null clears it
  // (Channel.defaultClock is SetNull), reverting the channel to silence-safe fallback.
  defaultClockId: z.string().min(1).nullable().optional(),
  // Enforce schedule-aware streamer auth (ADR D18); DB default is true.
  enforceSchedule: z.boolean().optional(),
});
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

/** What a listener/operator needs to consume a channel from their own frontend (ADR D9).
 *  hls/icecast are null when the channel's deliveryMode doesn't emit that output. */
export interface ChannelEndpoints {
  hls: string | null; // .../hls/<slug>/live.m3u8
  icecast: string | null; // .../icecast/<slug>
  nowPlaying: string; // .../hls/<slug>/nowplaying.json (always present)
  ingest: {
    host: string;
    port: number;
    mount: string; // /<slug>
    username: "source";
    protocol: "icecast";
    tls: boolean; // TLS terminated at Caddy (ADR D10) — streamer client must enable TLS
  };
}

export interface ChannelDto {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  deliveryMode: DeliveryMode;
  hlsBitrates: number[];
  icecastBitrate: number;
  mount: string;
  harborPort: number;
  endpoints: ChannelEndpoints;
  live: boolean; // is a streamer currently connected (vs fallback loop)?
  /** Auto-DJ that fills unscheduled time (ADR D17); null = silence fallback. */
  defaultClockId: string | null;
  /** D18: live ingest allowed only during the owner's scheduled live shows. */
  enforceSchedule: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Stream keys ────────────────────────────────────────────────────────────────

/** Returned exactly once on creation — the plaintext key is never stored or shown again. */
export interface StreamKeyCreatedDto {
  id: string;
  channelId: string;
  key: string; // plaintext, shown once
  createdAt: string;
}

export interface StreamKeyDto {
  id: string;
  channelId: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

// ── Now-playing ──────────────────────────────────────────────────────────────

export const nowPlayingSchema = z.object({
  slug: slugSchema,
  title: z.string().default(""),
  artist: z.string().default(""),
});
export type NowPlayingInput = z.infer<typeof nowPlayingSchema>;

export interface NowPlayingDto {
  title: string;
  artist: string;
  live: boolean;
  updatedAt: string;
}

// ── CDN (one-toggle auto-provisioning, ADR D4 / SPEC §7.2) ──────────────────────

/** CDN providers Aerial can auto-provision. Bunny-first; pluggable per ADR D4. */
export const CDN_PROVIDERS = ["bunny"] as const;
export const cdnProviderSchema = z.enum(CDN_PROVIDERS);
export type CdnProvider = (typeof CDN_PROVIDERS)[number];

/** Provisioning lifecycle: disabled → provisioning → active | error. */
export const CDN_STATUSES = ["disabled", "provisioning", "active", "error"] as const;
export const cdnStatusSchema = z.enum(CDN_STATUSES);
export type CdnStatus = (typeof CDN_STATUSES)[number];

/** Operator pastes their account-level Bunny API key (stored encrypted at rest). */
export const cdnKeySchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
});
export type CdnKeyInput = z.infer<typeof cdnKeySchema>;

/** CDN status surfaced to the operator. The API key itself is never returned. */
export interface CdnConfigDto {
  provider: CdnProvider;
  status: CdnStatus;
  hasApiKey: boolean; // whether a key is stored (never the key itself)
  cdnHostname: string | null; // <zone>.b-cdn.net once provisioned
  errorMessage: string | null; // populated when status === "error"
  updatedAt: string;
}

// ── Internal: Liquidsoap harbor auth hook ──────────────────────────────────────

export const authHookSchema = z.object({
  mount: z.string(),
  user: z.string(),
  password: z.string(),
  /** Streamer ingest address (harbor auth callback exposes it; ADR D10 logging). */
  address: z.string().optional(),
});
export type AuthHookInput = z.infer<typeof authHookSchema>;

export interface AuthHookResult {
  allowed: boolean;
}

// ── Internal: Liquidsoap harbor connect/disconnect status hook ──────────────────

export const statusHookSchema = z.object({
  slug: slugSchema,
  live: z.boolean(),
  /** Present on connect only (replayed from the auth callback's address). */
  address: z.string().optional(),
});
export type StatusHookInput = z.infer<typeof statusHookSchema>;

// ── Internal: Auto-DJ next-track hook (ADR D17) ────────────────────────────────

export const nextTrackHookSchema = z.object({ slug: slugSchema });
export type NextTrackHookInput = z.infer<typeof nextTrackHookSchema>;

// ── Auto-DJ enums & primitives (ADR D17) ────────────────────────────────────────
// These back both the TEXT-column codecs (src/prisma/db-columns.ts) and the input
// schemas below, so the enum/validation lives once.

/** How a playlist draws its next track when a clock slot pulls from it. */
export const PLAYLIST_ORDERS = ["shuffle", "sequential", "random"] as const;
export const playlistOrderSchema = z.enum(PLAYLIST_ORDERS);
export type PlaylistOrder = (typeof PLAYLIST_ORDERS)[number];

/** A Show is exactly one of these (plan §Core model). */
export const SHOW_TYPES = ["scheduled", "live"] as const;
export const showTypeSchema = z.enum(SHOW_TYPES);
export type ShowType = (typeof SHOW_TYPES)[number];

/** Days a recurring show airs: JSON int array, 0=Sunday..6=Saturday, unique, >=1. */
export const daysOfWeekSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, "name at least one day")
  .refine((days) => new Set(days).size === days.length, "days must be unique");
export type DaysOfWeek = z.infer<typeof daysOfWeekSchema>;

/** 24-hour wall-clock time "HH:MM" (server-local; per-install TZ). */
export const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM (24-hour)");

// ── Auto-DJ: tracks, playlists, clocks (ADR D17) ────────────────────────────────

/** Editable track metadata + cue/fade/loudness. All optional — a partial (PATCH)
 *  update over metadata that ffprobe seeded on upload. */
export const createTrackMetaSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  artist: z.string().max(300).nullable().optional(),
  album: z.string().max(300).nullable().optional(),
  cueIn: z.number().min(0).optional(),
  cueOut: z.number().min(0).nullable().optional(),
  fadeIn: z.number().min(0).optional(),
  fadeOut: z.number().min(0).optional(),
  amplifyDb: z.number().optional(),
});
export type CreateTrackMetaInput = z.infer<typeof createTrackMetaSchema>;

export const createPlaylistSchema = z.object({
  name: z.string().min(1).max(120),
  order: playlistOrderSchema.default("shuffle"),
  dedupWindowMin: z.number().int().min(0).default(60),
  isJingle: z.boolean().default(false),
});
export type CreatePlaylistInput = z.infer<typeof createPlaylistSchema>;

export const updatePlaylistSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  order: playlistOrderSchema.optional(),
  dedupWindowMin: z.number().int().min(0).optional(),
  isJingle: z.boolean().optional(),
});
export type UpdatePlaylistInput = z.infer<typeof updatePlaylistSchema>;

/** One slot of a clockwheel: draw `count` tracks from `playlistId` at `position`. */
export const clockSlotInputSchema = z.object({
  position: z.number().int().min(0),
  playlistId: z.string().min(1),
  count: z.number().int().min(1).default(1),
});
export type ClockSlotInput = z.infer<typeof clockSlotInputSchema>;

export const createClockSchema = z.object({
  name: z.string().min(1).max(120),
  slots: z.array(clockSlotInputSchema).min(1, "a clock needs at least one slot"),
});
export type CreateClockInput = z.infer<typeof createClockSchema>;

// ── Auto-DJ: shows (ADR D17/D18) ────────────────────────────────────────────────
// A Show is a channel-scoped programming block (channelId comes from the route).
// Discriminated by `type`: `scheduled` references a Clock; `live` references the
// owning User (streamer/admin). endTime < startTime wraps past midnight.

const showBaseSchema = z.object({
  title: z.string().min(1).max(200),
  startTime: hhmmSchema,
  endTime: hhmmSchema,
  daysOfWeek: daysOfWeekSchema.default([0, 1, 2, 3, 4, 5, 6]),
  dateStart: z.coerce.date().optional(),
  dateEnd: z.coerce.date().optional(),
  priority: z.number().int().default(0),
});

export const createShowSchema = z.discriminatedUnion("type", [
  showBaseSchema.extend({
    type: z.literal("scheduled"),
    clockId: z.string().min(1), // the Auto-DJ program this window runs
  }),
  showBaseSchema.extend({
    type: z.literal("live"),
    ownerId: z.string().min(1), // the User allowed to broadcast during this window
  }),
]);
export type CreateShowInput = z.infer<typeof createShowSchema>;
