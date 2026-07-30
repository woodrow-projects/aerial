import { useState } from "react";
import { ListMusic, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import type { PlaylistDto } from "./types";
import { usePlaylists, useDeletePlaylist } from "./hooks";
import { PlaylistDialog } from "./PlaylistDialog";
import { TrackMembershipEditor } from "./TrackMembershipEditor";

/**
 * Playlists section of the programming screen: every install-level playlist with
 * its draw order, track count and jingle flag, plus create/edit, ordered track
 * membership, and delete. A delete blocked because the playlist is wired into a
 * clock slot surfaces the server's 409 (which names the clocks) inline.
 */
export function PlaylistsPanel() {
  const playlists = usePlaylists();
  const list = playlists.data ?? [];
  const del = useDeletePlaylist();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlaylistDto | null>(null);
  const [tracksFor, setTracksFor] = useState<PlaylistDto | null>(null);

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Playlists</h2>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          New playlist
        </Button>
      </div>

      {playlists.error && <ErrorNote>{(playlists.error as Error).message}</ErrorNote>}
      {del.error && <ErrorNote>{(del.error as Error).message}</ErrorNote>}

      {playlists.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">No playlists yet. Create your first one above.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Tracks</TableHead>
              <TableHead>Dedup</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {p.name}
                    {p.isJingle && <Badge variant="on">Jingle</Badge>}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{p.order}</TableCell>
                <TableCell>{p.trackCount}</TableCell>
                <TableCell className="text-muted-foreground">{p.dedupWindowMin}m</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTracksFor(p)}
                      aria-label={`Tracks for ${p.name}`}
                    >
                      <ListMusic />
                      Tracks
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(p)}
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil />
                      Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          aria-label={`Delete ${p.name}`}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete playlist “{p.name}”?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the playlist and its track membership. Tracks stay in the
                            library. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="border border-destructive bg-transparent text-destructive hover:bg-destructive/10"
                            onClick={() => del.mutate(p.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {creating && <PlaylistDialog open onOpenChange={(o) => !o && setCreating(false)} />}
      {editing && (
        <PlaylistDialog
          open
          playlist={editing}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
      {tracksFor && (
        <TrackMembershipEditor
          open
          playlist={tracksFor}
          onOpenChange={(o) => !o && setTracksFor(null)}
        />
      )}
    </div>
  );
}
