import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CdnConfigDto, CdnStatus } from "@aerial/shared";
import { api } from "@/api";
import { channelsKey } from "@/features/channels/hooks";

/**
 * Server-state hooks for the one-toggle CDN. Replaces the two hand-rolled
 * effects in the old CdnSettings: the initial load and the 3s "watch
 * provisioning -> active" poll (`setInterval`). The poll is now a Query
 * `refetchInterval` that self-disables once the status settles.
 */

export const cdnKey = ["cdn"] as const;

/** How often to re-check the CDN while it is still provisioning. */
export const CDN_PROVISIONING_REFETCH_MS = 3000;

/** Poll only while provisioning (was the `setInterval` guarded on `status === "provisioning"`). */
export function cdnRefetchInterval(data: CdnConfigDto | undefined): number | false {
  return data?.status === "provisioning" ? CDN_PROVISIONING_REFETCH_MS : false;
}

/**
 * True at the moment provisioning finishes — when endpoints flip to the CDN and
 * the channels list must be refetched (the old `if (next.status !== "provisioning") onChange()`).
 */
export function cdnBecameProvisioned(prev: CdnStatus | undefined, next: CdnStatus): boolean {
  return prev === "provisioning" && next !== "provisioning";
}

export function useCdn() {
  return useQuery({
    queryKey: cdnKey,
    queryFn: api.getCdn,
    refetchInterval: (query) => cdnRefetchInterval(query.state.data),
  });
}

export function useSetCdnKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => api.setCdnKey(apiKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: cdnKey }),
  });
}

export function useEnableCdn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.enableCdn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: cdnKey }),
  });
}

export function useDisableCdn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.disableCdn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: cdnKey }),
  });
}

/** Invalidate the channels list — call when provisioning settles so the endpoints re-render. */
export function useInvalidateChannels() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: channelsKey });
}
