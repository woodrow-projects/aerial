/**
 * Pure helpers for the channel-level Auto-DJ controls — kept out of the React
 * components so the fiddly bits (the null-clock <-> Select sentinel round-trip and
 * the "what played" label parsed from a Liquidsoap annotate URI) are unit-tested
 * in isolation. No React, no fetch.
 */

/** Radix Select cannot hold null/"" as a value, so "no default clock" rides on this
 *  sentinel; {@link clockSelectPayload} maps it back to null for the PATCH body. */
export const NONE_CLOCK = "__none__";

/** The controlled Select value for a channel's current default clock. */
export function clockSelectValue(defaultClockId: string | null | undefined): string {
  return defaultClockId ?? NONE_CLOCK;
}

/** The PATCH `defaultClockId` for a chosen Select value (sentinel -> null clears it). */
export function clockSelectPayload(value: string): string | null {
  return value === NONE_CLOCK ? null : value;
}

/**
 * The human "what played" label for a PlayLog row. The DTO carries no title — it's
 * embedded in the served annotate URI (`annotate:...,title="...":<abs path>`), so we
 * pull it from there, un-escaping the `\\` / `\"` that buildAnnotateUri wrote, and
 * fall back to the file basename (then a placeholder) when there is no title.
 */
export function playlogTitle(uri: string): string {
  if (!uri) return "Unknown track";
  const match = uri.match(/title="((?:\\.|[^"\\])*)"/);
  if (match) return match[1].replace(/\\(.)/g, "$1");
  const path = uri.slice(uri.lastIndexOf(":") + 1);
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base || "Unknown track";
}
