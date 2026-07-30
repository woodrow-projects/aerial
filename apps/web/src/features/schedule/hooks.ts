/**
 * Server-state hooks for the schedule feature — the same TanStack Query idiom as
 * channels/programming/users: the `scheduleApi` client fns are the query/mutation
 * fns, and every mutation invalidates exactly the queries whose data it changed.
 * A Show mutation moves both the shows list AND the now/next resolution, so each
 * invalidates both. Channel-scoped resources nest under the channel key (matching
 * the channels feature's `keysKey`); the shared clock/user lists reuse the
 * well-known list keys so the cache is shared with those features.
 *
 * The now/next strip is inherently time-sensitive (its "now" advances), so it
 * refetches on a modest interval — the one exception to "poll nothing".
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { scheduleApi } from "./api";
import type { CreateShowBody, UpdateShowBody } from "./types";

export const channelsKey = ["channels"] as const;
export const showsKey = (channelId: string) => ["channels", channelId, "shows"] as const;
export const scheduleKey = (channelId: string) => ["channels", channelId, "schedule"] as const;
export const clocksKey = ["clocks"] as const;
export const usersKey = ["users"] as const;

/** Refresh cadence for the now/next strip — "now" advances even with no edits. */
export const SCHEDULE_REFETCH_MS = 60_000;

// ── Queries ──────────────────────────────────────────────────────────────────

export function useChannels() {
  return useQuery({ queryKey: channelsKey, queryFn: scheduleApi.listChannels });
}

export function useShows(channelId: string | undefined) {
  return useQuery({
    queryKey: showsKey(channelId ?? ""),
    queryFn: () => scheduleApi.listShows(channelId as string),
    enabled: !!channelId,
  });
}

export function useScheduleNowNext(channelId: string | undefined) {
  return useQuery({
    queryKey: scheduleKey(channelId ?? ""),
    queryFn: () => scheduleApi.getSchedule(channelId as string),
    enabled: !!channelId,
    refetchInterval: SCHEDULE_REFETCH_MS,
  });
}

/** Install-level clock list for the scheduled-show clock picker (open to read). */
export function useClocks(enabled = true) {
  return useQuery({ queryKey: clocksKey, queryFn: scheduleApi.listClocks, enabled });
}

/** Operator list for the live-show owner picker (admin-only server-side: 403 for
 *  streamers, tolerated by the caller — the block/editor falls back to a label). */
export function useUsers(enabled = true) {
  return useQuery({ queryKey: usersKey, queryFn: scheduleApi.listUsers, enabled });
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export function useCreateShow(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShowBody) => scheduleApi.createShow(channelId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: showsKey(channelId) });
      qc.invalidateQueries({ queryKey: scheduleKey(channelId) });
    },
  });
}

export function useUpdateShow(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ showId, body }: { showId: string; body: UpdateShowBody }) =>
      scheduleApi.updateShow(channelId, showId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: showsKey(channelId) });
      qc.invalidateQueries({ queryKey: scheduleKey(channelId) });
    },
  });
}

export function useDeleteShow(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (showId: string) => scheduleApi.deleteShow(channelId, showId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: showsKey(channelId) });
      qc.invalidateQueries({ queryKey: scheduleKey(channelId) });
    },
  });
}
