import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorNote } from "@/components/error-note";
import type { PlaylistDto } from "./types";
import { useMedia, usePlaylist, useSetPlaylistTracks } from "./hooks";

/**
 * Ordered track-membership editor for one playlist. Loads the playlist's current
 * ordered members (GET :id) and the full media library (the picker). The operator
 * adds tracks from the library, removes members, and reorders with up/down buttons
 * (no drag lib); "Save tracks" commits the whole sequence as one ordered PUT — the
 * array order IS the position. Nothing is written until save.
 */

const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export function TrackMembershipEditor({
  playlist,
  open,
  onOpenChange,
}: {
  playlist: PlaylistDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = usePlaylist(playlist.id);
  const media = useMedia();
  const library = media.data ?? [];
  const save = useSetPlaylistTracks(playlist.id);

  const [order, setOrder] = useState<string[]>([]);
  const inited = useRef(false);

  useEffect(() => {
    if (detail.data && !inited.current) {
      inited.current = true;
      setOrder(detail.data.tracks.map((t) => t.trackId));
    }
  }, [detail.data]);

  // Title/artist lookup for any id we might render (members or library rows).
  const meta = useMemo(() => {
    const m = new Map<string, { title: string; artist: string | null; durationSec: number }>();
    for (const t of library) m.set(t.id, { title: t.title, artist: t.artist, durationSec: t.durationSec });
    for (const t of detail.data?.tracks ?? []) {
      if (!m.has(t.trackId)) m.set(t.trackId, { title: t.title, artist: t.artist, durationSec: t.durationSec });
    }
    return m;
  }, [library, detail.data]);

  const inPlaylist = new Set(order);
  const addable = library.filter((t) => !inPlaylist.has(t.id));

  const moveUp = (i: number) =>
    setOrder((cur) => (i <= 0 ? cur : swap(cur, i, i - 1)));
  const moveDown = (i: number) =>
    setOrder((cur) => (i >= cur.length - 1 ? cur : swap(cur, i, i + 1)));
  const remove = (id: string) => setOrder((cur) => cur.filter((x) => x !== id));
  const add = (id: string) => setOrder((cur) => [...cur, id]);

  const commit = async () => {
    try {
      await save.mutateAsync(order);
      onOpenChange(false);
    } catch {
      // surfaced via ErrorNote below
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tracks — {playlist.name}</DialogTitle>
          <DialogDescription>
            Order is the play sequence for this playlist. Add from the library, reorder, then save.
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="grid content-start gap-2">
              <h3 className="text-sm font-semibold">Membership ({order.length})</h3>
              {order.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tracks yet — add some from the library.</p>
              ) : (
                <ul className="grid gap-1">
                  {order.map((id, i) => {
                    const m = meta.get(id);
                    const title = m?.title ?? id;
                    return (
                      <li
                        key={id}
                        className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                      >
                        <span className="w-5 text-xs text-muted-foreground">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{title}</div>
                          {m?.artist && (
                            <div className="truncate text-xs text-muted-foreground">{m.artist}</div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Move ${title} up`}
                          disabled={i === 0}
                          onClick={() => moveUp(i)}
                        >
                          <ChevronUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Move ${title} down`}
                          disabled={i === order.length - 1}
                          onClick={() => moveDown(i)}
                        >
                          <ChevronDown />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          aria-label={`Remove ${title}`}
                          onClick={() => remove(id)}
                        >
                          <X />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="grid content-start gap-2">
              <h3 className="text-sm font-semibold">Library</h3>
              {addable.length === 0 ? (
                <p className="text-sm text-muted-foreground">Every library track is already a member.</p>
              ) : (
                <ul className="grid gap-1">
                  {addable.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{t.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {t.artist ? `${t.artist} · ` : ""}
                          {fmtDuration(t.durationSec)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Add ${t.title}`}
                        onClick={() => add(t.id)}
                      >
                        <Plus />
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {save.error && <ErrorNote>{(save.error as Error).message}</ErrorNote>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={commit} disabled={save.isPending}>
            Save tracks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const next = [...arr];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
