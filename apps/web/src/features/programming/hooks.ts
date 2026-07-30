/**
 * Server-state hooks for the programming feature — the same TanStack Query idiom
 * as channels/cdn/users: the `programmingApi` client fns are the query/mutation
 * fns, and every mutation invalidates exactly the queries whose data it changed.
 * Nothing here polls (the plan: "poll nothing; invalidate on mutate"). List and
 * detail resources are namespaced distinctly so a membership/slot edit refreshes
 * both the list (counts) and that one detail.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateClockInput, CreatePlaylistInput, UpdatePlaylistInput } from "@aerial/shared";
import { programmingApi, type UpdateClockInput } from "./api";

export const playlistsKey = ["playlists"] as const;
export const playlistKey = (id: string) => ["playlists", id] as const;
export const clocksKey = ["clocks"] as const;
export const clockKey = (id: string) => ["clocks", id] as const;
export const mediaKey = ["media"] as const;

// ── Queries ──────────────────────────────────────────────────────────────────

export function usePlaylists() {
  return useQuery({ queryKey: playlistsKey, queryFn: programmingApi.listPlaylists });
}

export function usePlaylist(id: string | undefined) {
  return useQuery({
    queryKey: playlistKey(id ?? ""),
    queryFn: () => programmingApi.getPlaylist(id as string),
    enabled: !!id,
  });
}

export function useClocks() {
  return useQuery({ queryKey: clocksKey, queryFn: programmingApi.listClocks });
}

export function useClock(id: string | undefined) {
  return useQuery({
    queryKey: clockKey(id ?? ""),
    queryFn: () => programmingApi.getClock(id as string),
    enabled: !!id,
  });
}

export function useMedia() {
  return useQuery({ queryKey: mediaKey, queryFn: programmingApi.listMedia });
}

// ── Playlist mutations ─────────────────────────────────────────────────────────

export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlaylistInput) => programmingApi.createPlaylist(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistsKey }),
  });
}

export function useUpdatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePlaylistInput }) =>
      programmingApi.updatePlaylist(id, input),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: playlistsKey });
      qc.invalidateQueries({ queryKey: playlistKey(id) });
    },
  });
}

export function useSetPlaylistTracks(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trackIds: string[]) => programmingApi.setPlaylistTracks(id, trackIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: playlistsKey });
      qc.invalidateQueries({ queryKey: playlistKey(id) });
    },
  });
}

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => programmingApi.deletePlaylist(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: playlistsKey }),
  });
}

// ── Clock mutations ──────────────────────────────────────────────────────────

export function useCreateClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateClockInput) => programmingApi.createClock(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: clocksKey }),
  });
}

export function useUpdateClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateClockInput }) =>
      programmingApi.updateClock(id, input),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: clocksKey });
      qc.invalidateQueries({ queryKey: clockKey(id) });
    },
  });
}

export function useDeleteClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => programmingApi.deleteClock(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: clocksKey }),
  });
}
