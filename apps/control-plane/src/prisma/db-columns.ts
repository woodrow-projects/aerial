import {
  cdnProviderSchema,
  cdnStatusSchema,
  daysOfWeekSchema,
  deliveryModeSchema,
  hhmmSchema,
  hlsBitratesSchema,
  playlistOrderSchema,
  showTypeSchema,
  type CdnProvider,
  type CdnStatus,
  type DeliveryMode,
  type PlaylistOrder,
  type ShowType,
} from "@aerial/shared";

/**
 * SQLite column codecs. SQLite (via Prisma) has no native enum or scalar-list
 * columns, so those fields are stored as TEXT and validated here — the shared
 * zod schemas stay the single source of truth. Every value is written through
 * these codecs, so a parse failure means the row was edited outside the app;
 * fail loudly rather than stream with a silently-corrected config.
 */

export function serializeHlsBitrates(bitrates: number[]): string {
  return JSON.stringify(hlsBitratesSchema.parse(bitrates));
}

export function parseHlsBitrates(raw: string): number[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`invalid hlsBitrates column value: ${raw}`);
  }
  const parsed = hlsBitratesSchema.safeParse(value);
  if (!parsed.success) throw new Error(`invalid hlsBitrates column value: ${raw}`);
  return parsed.data;
}

export function parseDeliveryMode(raw: string): DeliveryMode {
  const parsed = deliveryModeSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid deliveryMode column value: ${raw}`);
  return parsed.data;
}

export function parseCdnProvider(raw: string): CdnProvider {
  const parsed = cdnProviderSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid CDN provider column value: ${raw}`);
  return parsed.data;
}

export function parseCdnStatus(raw: string): CdnStatus {
  const parsed = cdnStatusSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid CDN status column value: ${raw}`);
  return parsed.data;
}

// ── Auto-DJ TEXT-enum columns (ADR D17) ─────────────────────────────────────────

export function parsePlaylistOrder(raw: string): PlaylistOrder {
  const parsed = playlistOrderSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid playlist order column value: ${raw}`);
  return parsed.data;
}

export function parseShowType(raw: string): ShowType {
  const parsed = showTypeSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid show type column value: ${raw}`);
  return parsed.data;
}

export function serializeDaysOfWeek(days: number[]): string {
  return JSON.stringify(daysOfWeekSchema.parse(days));
}

export function parseDaysOfWeek(raw: string): number[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`invalid daysOfWeek column value: ${raw}`);
  }
  const parsed = daysOfWeekSchema.safeParse(value);
  if (!parsed.success) throw new Error(`invalid daysOfWeek column value: ${raw}`);
  return parsed.data;
}

export function parseHhmm(raw: string): string {
  const parsed = hhmmSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid HH:MM column value: ${raw}`);
  return parsed.data;
}
