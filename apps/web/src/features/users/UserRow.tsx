import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ErrorNote } from "@/components/error-note";
import type { Role, UserSummary } from "./api";
import { isDemotion, useCreateStreamerKey, useRevokeStreamerKey, useSetRole } from "./hooks";

/**
 * One operator row: identity + role badge + key status, an inline role picker
 * (with a confirm gate on demotions — the server also blocks demoting the last
 * admin, 409), and per-user streamer-key management. The freshly issued key is
 * shown exactly once (the same "copy it now" idiom as channel stream keys):
 * dismissing it calls the mutation's reset(), so the plaintext is unrecoverable.
 */
export function UserRow({ user }: { user: UserSummary }) {
  const setRole = useSetRole();
  const createKey = useCreateStreamerKey();
  const revokeKey = useRevokeStreamerKey();

  // The role a pending demotion would apply; non-null while the confirm dialog is open.
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const [copied, setCopied] = useState(false);

  const newKey = createKey.data;
  const error = (setRole.error ?? createKey.error ?? revokeKey.error) as Error | null;

  const onRoleChange = (next: Role) => {
    if (next === user.role) return;
    // Demotions strip all admin control — confirm first; promotions apply directly.
    if (isDemotion(user.role, next)) setPendingRole(next);
    else setRole.mutate({ id: user.id, role: next });
  };

  const confirmDemotion = () => {
    if (pendingRole) setRole.mutate({ id: user.id, role: pendingRole });
    setPendingRole(null);
  };

  const copyKey = () => {
    if (!newKey) return;
    void navigator.clipboard?.writeText(newKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const dismissKey = () => {
    setCopied(false);
    createKey.reset(); // the plaintext is gone forever after this
  };

  return (
    <Card>
      <CardContent className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">{user.name}</h3>
            <span className="text-sm text-muted-foreground">{user.email}</span>
          </div>
          <div className="flex gap-2">
            <Badge variant={user.role === "admin" ? "on" : "default"}>{user.role}</Badge>
            <Badge variant={user.hasStreamerKey ? "live" : "off"}>
              {user.hasStreamerKey ? "key set" : "no key"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            Role
            <Select
              value={user.role}
              disabled={setRole.isPending}
              onValueChange={(v) => onRoleChange(v as Role)}
            >
              <SelectTrigger className="h-9 w-[160px]" aria-label="Role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="streamer">streamer</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>

        <Separator />

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm">Streamer key</strong>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={createKey.isPending}
                onClick={() => createKey.mutate(user.id)}
              >
                {user.hasStreamerKey ? "Regenerate" : "Issue key"}
              </Button>
              {user.hasStreamerKey && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-destructive">
                      Revoke
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke {user.name}’s streamer key?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Their key stops working immediately and they cannot go live until you
                        issue a new one. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="border border-destructive bg-transparent text-destructive hover:bg-destructive/10"
                        onClick={() => revokeKey.mutate(user.id)}
                      >
                        Revoke
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          <p className="text-[13px] text-muted-foreground">
            A streamer key authenticates this user’s live ingest during their scheduled live shows.
          </p>

          {newKey && (
            <div className="grid gap-1.5 rounded-md border border-live bg-live/10 p-2.5 text-[13px]">
              Copy this now — it is shown only once:
              <code className="overflow-x-auto rounded bg-input-surface px-2 py-1 font-mono text-xs">
                {newKey.key}
              </code>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={copyKey}>
                  {copied ? <Check className="text-live" /> : <Copy />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button variant="ghost" size="sm" onClick={dismissKey}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Controlled confirm gate for demotions (no trigger — opened from the role picker). */}
        <AlertDialog
          open={pendingRole !== null}
          onOpenChange={(open) => {
            if (!open) setPendingRole(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Demote {user.name} to streamer?</AlertDialogTitle>
              <AlertDialogDescription>
                They lose all admin control and keep read-only panel access. You can promote them
                again later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingRole(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDemotion}>Demote</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {error && <ErrorNote>{error.message}</ErrorNote>}
      </CardContent>
    </Card>
  );
}
