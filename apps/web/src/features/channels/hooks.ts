import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateChannelInput, DeliveryMode } from "@aerial/shared";
import { api } from "@/api";

/**
 * Server-state hooks for channels + stream keys — the TanStack Query layer that
 * replaces the hand-rolled `fetch` + `setInterval(refresh, 5000)` in the old
 * App.tsx. The `api` client fns are the query/mutation fns; every mutation
 * invalidates the queries whose data it changed (the old manual `refresh()`).
 */

export const channelsKey = ["channels"] as const;
export const keysKey = (channelId: string) => ["channels", channelId, "keys"] as const;

/** Poll interval for live state (streamer connected / fallback) — was `setInterval`. */
export const CHANNELS_REFETCH_MS = 5000;

export function channelsQueryOptions() {
  return {
    queryKey: channelsKey,
    queryFn: api.listChannels,
    refetchInterval: CHANNELS_REFETCH_MS,
  };
}

export function useChannels() {
  return useQuery(channelsQueryOptions());
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChannelInput) => api.createChannel(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey }),
  });
}

export function useSetActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.setActive(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey }),
  });
}

export function useSetDeliveryMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deliveryMode }: { id: string; deliveryMode: DeliveryMode }) =>
      api.setDeliveryMode(id, deliveryMode),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey }),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteChannel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey }),
  });
}

// ── Stream keys ────────────────────────────────────────────────────────────────

export function useStreamKeys(channelId: string) {
  return useQuery({
    queryKey: keysKey(channelId),
    queryFn: () => api.listKeys(channelId),
  });
}

export function useCreateKey(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.createKey(channelId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keysKey(channelId) }),
  });
}

export function useRevokeKey(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => api.revokeKey(channelId, keyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keysKey(channelId) }),
  });
}
