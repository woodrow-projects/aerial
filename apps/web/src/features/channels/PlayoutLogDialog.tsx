import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorNote } from "@/components/error-note";
import { usePlaylog } from "./hooks";
import { playlogTitle } from "./lib";

/**
 * The "why did this track play" view (ADR D17, plan §Playout). Reads the newest-first
 * PlayLog decisions for a channel and shows, per row, the served time, the track title
 * (parsed from the annotate URI — the DTO carries no title) and the engine's reason
 * line. Read on open, refreshed only by the button — never polled (see usePlaylog).
 */
export function PlayoutLogDialog({
  channelId,
  channelName,
  open,
  onOpenChange,
}: {
  channelId: string;
  channelName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const playlog = usePlaylog(channelId, { enabled: open });
  const entries = playlog.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Playout log — {channelName}</DialogTitle>
          <DialogDescription>
            Why each track played, newest first. Auto-DJ decisions only — a live streamer
            bypasses the log.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {entries.length > 0 ? `${entries.length} recent decision${entries.length === 1 ? "" : "s"}` : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={playlog.isFetching}
            onClick={() => playlog.refetch()}
          >
            {playlog.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {playlog.error && <ErrorNote>{(playlog.error as Error).message}</ErrorNote>}

        {playlog.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 && !playlog.error ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No playout decisions yet. They appear once Auto-DJ serves this channel.
          </p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">
            {entries.map((e) => (
              <li key={e.id} className="grid gap-0.5 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{playlogTitle(e.uri)}</span>
                  <time
                    dateTime={e.at}
                    className="shrink-0 font-mono text-xs text-muted-foreground"
                  >
                    {new Date(e.at).toLocaleString()}
                  </time>
                </div>
                <span className="text-xs text-muted-foreground">{e.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
