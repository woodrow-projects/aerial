import { useState } from "react";
import { PLAYLIST_ORDERS, type PlaylistOrder } from "@aerial/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useCreatePlaylist, useUpdatePlaylist } from "./hooks";

/**
 * Create/edit a playlist's configuration (name, draw order, dedup window, jingle
 * flag). Controlled by the panel: `open` + `onOpenChange`. With a `playlist` it is
 * an edit (prefilled, PATCH); without one it is a create (POST). Submitting closes
 * on success; a server error (e.g. duplicate name) is surfaced inline via ErrorNote.
 */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function PlaylistDialog({
  open,
  onOpenChange,
  playlist,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist?: PlaylistDto;
}) {
  const isEdit = !!playlist;
  const [name, setName] = useState(playlist?.name ?? "");
  const [order, setOrder] = useState<PlaylistOrder>(playlist?.order ?? "shuffle");
  const [dedup, setDedup] = useState(String(playlist?.dedupWindowMin ?? 60));
  const [isJingle, setIsJingle] = useState(playlist?.isJingle ?? false);

  const create = useCreatePlaylist();
  const update = useUpdatePlaylist();
  const error = (create.error ?? update.error) as Error | null;
  const pending = create.isPending || update.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = { name, order, dedupWindowMin: Number(dedup) || 0, isJingle };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: playlist!.id, input });
      } else {
        await create.mutateAsync(input);
      }
      onOpenChange(false);
    } catch {
      // surfaced via ErrorNote below
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit playlist" : "New playlist"}</DialogTitle>
          <DialogDescription>
            A named pool of tracks a clock slot draws from, with its own order and dedup window.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="playlist-name">Name</Label>
            <Input
              id="playlist-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Currents, Jingles"
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="playlist-order">Order</Label>
            <Select value={order} onValueChange={(v) => setOrder(v as PlaylistOrder)}>
              <SelectTrigger id="playlist-order" aria-label="Order">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAYLIST_ORDERS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {cap(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="playlist-dedup">Dedup window (minutes)</Label>
            <Input
              id="playlist-dedup"
              type="number"
              min={0}
              value={dedup}
              onChange={(e) => setDedup(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              id="playlist-jingle"
              type="checkbox"
              checked={isJingle}
              onChange={(e) => setIsJingle(e.target.checked)}
              className="size-4 rounded border border-input"
            />
            Jingle (hidden from now-playing)
          </label>

          {error && <ErrorNote>{error.message}</ErrorNote>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {isEdit ? "Save changes" : "Create playlist"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
