import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
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
import type { TrackDto } from "./api";
import { formatDuration } from "./lib";
import { EditTrackDialog } from "./EditTrackDialog";
import { useDeleteTrack } from "./hooks";

/** Confirm-before-delete: spells out that the track also leaves every playlist. */
function DeleteTrackButton({ track }: { track: TrackDto }) {
  const del = useDeleteTrack();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={del.isPending}>
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{track.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the file from the library and drops it from every playlist it belongs to.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {del.error && <ErrorNote>{(del.error as Error).message}</ErrorNote>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="border border-destructive bg-transparent text-destructive hover:bg-destructive/10"
            onClick={() => del.mutate(track.id)}
          >
            Delete track
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The library list: one row per track with its metadata, duration, and row actions. */
export function TrackTable({ tracks }: { tracks: TrackDto[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Artist</TableHead>
          <TableHead>Album</TableHead>
          <TableHead className="text-right">Duration</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tracks.map((track) => (
          <TableRow key={track.id}>
            <TableCell>
              <div className="font-medium">{track.title}</div>
              <div className="font-mono text-xs text-muted-foreground">{track.fileName}</div>
            </TableCell>
            <TableCell className="text-muted-foreground">{track.artist ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground">{track.album ?? "—"}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatDuration(track.durationSec)}
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                <EditTrackDialog track={track} />
                <DeleteTrackButton track={track} />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
