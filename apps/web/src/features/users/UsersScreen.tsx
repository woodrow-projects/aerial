import { ErrorNote } from "@/components/error-note";
import { UserRow } from "./UserRow";
import { useUsers } from "./hooks";

/**
 * Admin screen for user & role management (plan Phase E). Lists every operator
 * with their role and streamer-key status; each row manages that user's role
 * (admin/streamer) and per-user streamer key. The whole surface is admin-only
 * server-side — a streamer receives 403s, surfaced inline via ErrorNote.
 */
export function UsersScreen() {
  const users = useUsers();
  const list = users.data ?? [];

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Manage operator roles and the per-user streamer keys that authenticate live ingest.
        </p>
      </div>

      {users.error && <ErrorNote>{(users.error as Error).message}</ErrorNote>}

      {users.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">No users yet.</p>
      ) : (
        <div className="grid gap-4">
          {list.map((u) => (
            <UserRow key={u.id} user={u} />
          ))}
        </div>
      )}
    </div>
  );
}
