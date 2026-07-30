import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usersApi, type Role } from "./api";

/**
 * Server-state hooks for user & role administration — the same TanStack Query
 * idiom as the channels/cdn features: the `usersApi` client fns are the
 * query/mutation fns, and every mutation invalidates the users list it changed
 * (role flips, key issued/revoked all change a row's role or `hasStreamerKey`).
 */

export const usersKey = ["users"] as const;

/**
 * A role change is a *demotion* only when an admin is dropped to a non-admin
 * role — that strips all system control, so the UI confirms it (and the server
 * additionally blocks demoting the last admin, 409). Promotions apply directly.
 */
export function isDemotion(current: Role, next: Role): boolean {
  return current === "admin" && next !== "admin";
}

export function useUsers() {
  return useQuery({ queryKey: usersKey, queryFn: usersApi.list });
}

export function useSetRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => usersApi.setRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useCreateStreamerKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => usersApi.createStreamerKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useRevokeStreamerKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => usersApi.revokeStreamerKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
  });
}
