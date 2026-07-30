import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateTrackMetaInput } from "@aerial/shared";
import { listTracks, uploadTrack, updateTrack, deleteTrack } from "./api";

/**
 * Server-state hooks for the media library. `useTracks` is the read; every
 * mutation (upload / metadata patch / delete) invalidates the same list so the
 * table re-renders — the media analogue of the channels hooks.
 */

export const mediaKey = ["media"] as const;

export function useTracks() {
  return useQuery({ queryKey: mediaKey, queryFn: listTracks });
}

export function useUploadTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadTrack(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: mediaKey }),
  });
}

export function useUpdateTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateTrackMetaInput }) =>
      updateTrack(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: mediaKey }),
  });
}

export function useDeleteTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTrack(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: mediaKey }),
  });
}
