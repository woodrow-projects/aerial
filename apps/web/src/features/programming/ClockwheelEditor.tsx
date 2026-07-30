import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Minus, Plus, X } from "lucide-react";
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
import { Clockwheel } from "./Clockwheel";
import type { WheelSlot } from "./wheel";
import type { ClockDto } from "./types";
import { useClock, useCreateClock, usePlaylists, useUpdateClock } from "./hooks";

/**
 * The clockwheel editor — the product differentiator. Arranges a clock's ordered,
 * repeating slot sequence (each slot: a playlist + a track count = its airtime) as
 * a live-previewing wheel. Add/remove/reorder slots and step counts; positions are
 * always the array index, renumbered from 0 on save. Save commits the whole
 * sequence atomically (POST for a new clock, PATCH replacing all slots for an edit).
 */

interface SlotDraft {
  playlistId: string;
  count: number;
}

export function ClockwheelEditor({
  clock,
  open,
  onOpenChange,
}: {
  clock?: ClockDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = !!clock;
  const playlistsQ = usePlaylists();
  const playlists = playlistsQ.data ?? [];
  const detail = useClock(isEdit ? clock!.id : undefined);

  const create = useCreateClock();
  const update = useUpdateClock();
  const error = (create.error ?? update.error) as Error | null;
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(clock?.name ?? "");
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const inited = useRef(false);

  useEffect(() => {
    if (isEdit && detail.data && !inited.current) {
      inited.current = true;
      setName(detail.data.name);
      setSlots(detail.data.slots.map((s) => ({ playlistId: s.playlistId, count: s.count })));
    }
  }, [isEdit, detail.data]);

  const nameOf = useMemo(() => {
    const m = new Map(playlists.map((p) => [p.id, p.name] as const));
    return (id: string) => m.get(id) ?? "—";
  }, [playlists]);

  const addSlot = () => {
    if (playlists.length === 0) return;
    setSlots((cur) => [...cur, { playlistId: playlists[0].id, count: 1 }]);
  };
  const removeSlot = (i: number) => setSlots((cur) => cur.filter((_, idx) => idx !== i));
  const setPlaylist = (i: number, playlistId: string) =>
    setSlots((cur) => cur.map((s, idx) => (idx === i ? { ...s, playlistId } : s)));
  const step = (i: number, delta: number) =>
    setSlots((cur) =>
      cur.map((s, idx) => (idx === i ? { ...s, count: Math.max(1, s.count + delta) } : s)),
    );
  const move = (i: number, dir: -1 | 1) =>
    setSlots((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const wheelSlots: WheelSlot[] = slots.map((s, i) => ({
    position: i,
    playlistId: s.playlistId,
    playlistName: nameOf(s.playlistId),
    count: s.count,
  }));

  const canSave = !!name.trim() && slots.length > 0 && !pending;

  const commit = async () => {
    const payload = {
      name,
      slots: slots.map((s, i) => ({ position: i, playlistId: s.playlistId, count: s.count })),
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: clock!.id, input: payload });
      } else {
        await create.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {
      // surfaced via ErrorNote below
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit clockwheel" : "New clockwheel"}</DialogTitle>
          <DialogDescription>
            An ordered, repeating hour of slots. Each slot draws its track count from a playlist;
            the wheel shows each slot's share of airtime.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-[1fr_240px]">
          <div className="grid content-start gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="clock-name">Name</Label>
              <Input
                id="clock-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Daytime Music"
                required
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Slots</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addSlot}
                  disabled={playlists.length === 0}
                >
                  <Plus />
                  Add slot
                </Button>
              </div>

              {slots.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No slots yet — add one to start the rotation.
                </p>
              ) : (
                <ol className="grid gap-2">
                  {slots.map((s, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
                    >
                      <span className="w-5 text-xs text-muted-foreground">{i + 1}</span>

                      <Select value={s.playlistId} onValueChange={(v) => setPlaylist(i, v)}>
                        <SelectTrigger
                          aria-label={`Slot ${i + 1} playlist`}
                          className="h-9 w-[160px]"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {playlists.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-8"
                          aria-label={`Slot ${i + 1} decrease`}
                          onClick={() => step(i, -1)}
                        >
                          <Minus />
                        </Button>
                        <span
                          aria-label={`Slot ${i + 1} count`}
                          className="w-8 text-center text-sm tabular-nums"
                        >
                          {s.count}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-8"
                          aria-label={`Slot ${i + 1} increase`}
                          onClick={() => step(i, 1)}
                        >
                          <Plus />
                        </Button>
                      </div>

                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Move slot ${i + 1} up`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          <ChevronUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Move slot ${i + 1} down`}
                          disabled={i === slots.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ChevronDown />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive"
                          aria-label={`Remove slot ${i + 1}`}
                          onClick={() => removeSlot(i)}
                        >
                          <X />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          <div className="grid content-start justify-items-center gap-2">
            <Clockwheel slots={wheelSlots} />
            <p className="text-center text-xs text-muted-foreground">
              Each wedge is a slot, sized by its share of the hour.
            </p>
          </div>
        </div>

        {error && <ErrorNote>{error.message}</ErrorNote>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={commit} disabled={!canSave}>
            {isEdit ? "Save clock" : "Create clock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
