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
    tls: boolean; // TLS terminated at Caddy (ADR D10) — DJ client must enable TLS
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
  live: boolean; // is a DJ currently connected (vs fallback loop)?
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

// ── Internal: Liquidsoap harbor auth hook ──────────────────────────────────────

export const authHookSchema = z.object({
  mount: z.string(),
  user: z.string(),
  password: z.string(),
});
export type AuthHookInput = z.infer<typeof authHookSchema>;

export interface AuthHookResult {
  allowed: boolean;
}

// ── Internal: Liquidsoap harbor connect/disconnect status hook ──────────────────

export const statusHookSchema = z.object({
  slug: slugSchema,
  live: z.boolean(),
});
export type StatusHookInput = z.infer<typeof statusHookSchema>;
