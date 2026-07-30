import { ErrorNote } from "@/components/error-note";
import { UploadZone } from "./UploadZone";
import { TrackTable } from "./TrackTable";
import { useTracks } from "./hooks";

/**
 * Media library screen: upload zone on top, the track table below. The table is
 * the source pool the Auto-DJ clockwheels draw from; cue/fade/amplify edited per
 * track here drive playout.
 */
export function MediaScreen() {
  const tracks = useTracks();
  const list = tracks.data ?? [];

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Media library</h1>
        <p className="text-sm text-muted-foreground">
          Upload audio and tune each track&rsquo;s cue, fade and loudness — the pool the Auto-DJ
          plays from.
        </p>
      </div>

      {tracks.error && <ErrorNote>{(tracks.error as Error).message}</ErrorNote>}

      <UploadZone />

      {tracks.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">No tracks yet. Upload your first files above.</p>
      ) : (
        <TrackTable tracks={list} />
      )}
    </div>
  );
}
