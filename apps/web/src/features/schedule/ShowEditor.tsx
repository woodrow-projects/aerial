import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { ShowType } from "@aerial/shared";
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
import { DAY_LABELS, toggleDay } from "./lib";
import type { CreateShowBody, ShowDto, UpdateShowBody } from "./types";
import { useClocks, useCreateShow, useDeleteShow, useUpdateShow, useUsers } from "./hooks";

/**
 * The inline show editor — a create/edit dialog opened from the week grid (click a
 * block) or the "Add show" button. It edits the window (HH:MM), day-of-week
 * toggles, the type-specific clock (scheduled) or owner (live) reference, an
 * optional date range + priority, and offers a confirmed delete. `type` is only
 * choosable on create (immutable server-side once persisted). Validation is
 * client-side for the obvious cases; the server's rejections (unknown clock/owner,
 * a streamer's 403 on any mutation) surface verbatim via ErrorNote.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** ISO instant → "YYYY-MM-DD" for a native date input (empty when unset). */
function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

export function ShowEditor({
  channelId,
  show,
  open,
  onOpenChange,
}: {
  channelId: string;
  show?: ShowDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = !!show;

  const [type, setType] = useState<ShowType>(show?.type ?? "scheduled");
  const [title, setTitle] = useState(show?.title ?? "");
  const [startTime, setStartTime] = useState(show?.startTime ?? "06:00");
  const [endTime, setEndTime] = useState(show?.endTime ?? "10:00");
  const [days, setDays] = useState<number[]>(show?.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]);
  const [clockId, setClockId] = useState(show?.clockId ?? "");
  const [ownerId, setOwnerId] = useState(show?.ownerId ?? "");
  const [priority, setPriority] = useState<number>(show?.priority ?? 0);
  const [dateStart, setDateStart] = useState(toDateInput(show?.dateStart));
  const [dateEnd, setDateEnd] = useState(toDateInput(show?.dateEnd));
  const [localError, setLocalError] = useState<string | null>(null);

  // Clocks are open to read; the users list is admin-only (streamers get a 403,
  // tolerated). Each is only fetched for the type that needs it while the dialog is open.
  const clocks = useClocks(open && type === "scheduled").data ?? [];
  const usersQ = useUsers(open && type === "live");
  const owners = usersQ.data ?? [];

  const create = useCreateShow(channelId);
  const update = useUpdateShow(channelId);
  const del = useDeleteShow(channelId);
  const pending = create.isPending || update.isPending || del.isPending;
  const serverError = (create.error ?? update.error ?? del.error) as Error | null;
  const error = localError ?? serverError?.message ?? null;

  function validate(): string | null {
    if (!title.trim()) return "Title is required.";
    if (!HHMM.test(startTime)) return "Start time must be HH:MM (24-hour).";
    if (!HHMM.test(endTime)) return "End time must be HH:MM (24-hour).";
    if (days.length === 0) return "Select at least one day.";
    if (type === "scheduled" && !clockId) return "Choose a clock for this scheduled show.";
    if (type === "live" && !ownerId) return "Choose an owner for this live show.";
    return null;
  }

  async function submit() {
    const err = validate();
    if (err) {
      setLocalError(err);
      return;
    }
    setLocalError(null);
    try {
      if (isEdit) {
        const body: UpdateShowBody = {
          title: title.trim(),
          startTime,
          endTime,
          daysOfWeek: days,
          priority,
          dateStart: dateStart || null,
          dateEnd: dateEnd || null,
        };
        if (type === "scheduled") body.clockId = clockId;
        else body.ownerId = ownerId;
        await update.mutateAsync({ showId: show!.id, body });
      } else {
        const base = {
          title: title.trim(),
          startTime,
          endTime,
          daysOfWeek: days,
          priority,
          ...(dateStart ? { dateStart } : {}),
          ...(dateEnd ? { dateEnd } : {}),
        };
        const body: CreateShowBody =
          type === "scheduled"
            ? { ...base, type: "scheduled", clockId }
            : { ...base, type: "live", ownerId };
        await create.mutateAsync(body);
      }
      onOpenChange(false);
    } catch {
      // surfaced via ErrorNote below
    }
  }

  async function onDelete() {
    try {
      await del.mutateAsync(show!.id);
      onOpenChange(false);
    } catch {
      // surfaced via ErrorNote below
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit show" : "New show"}</DialogTitle>
          <DialogDescription>
            A programming block on this channel: when it airs and what fills it. Auto-DJ fills any
            time no show covers.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {isEdit ? (
            <p className="text-sm text-muted-foreground">
              Type: <span className="font-medium capitalize text-foreground">{type}</span>
            </p>
          ) : (
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <div role="group" aria-label="Show type" className="flex gap-1">
                {(["scheduled", "live"] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={type === t ? "default" : "outline"}
                    aria-pressed={type === t}
                    onClick={() => setType(t)}
                  >
                    {t === "scheduled" ? "Scheduled" : "Live"}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="show-title">Title</Label>
            <Input
              id="show-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Morning Drive"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="show-start">Start time</Label>
              <Input
                id="show-start"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="HH:MM"
                inputMode="numeric"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="show-end">End time</Label>
              <Input
                id="show-end"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="HH:MM"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Days</Label>
            <div role="group" aria-label="Days of week" className="flex flex-wrap gap-1">
              {DAY_LABELS.map((label, i) => {
                const on = days.includes(i);
                return (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    onClick={() => setDays((cur) => toggleDay(cur, i))}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>

          {type === "scheduled" ? (
            <div className="grid gap-1.5">
              <Label>Clock</Label>
              <Select value={clockId} onValueChange={setClockId}>
                <SelectTrigger aria-label="Clock">
                  <SelectValue placeholder="Select a clock" />
                </SelectTrigger>
                <SelectContent>
                  {clocks.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label>Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger aria-label="Owner">
                  <SelectValue placeholder="Select an owner" />
                </SelectTrigger>
                <SelectContent>
                  {owners.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {usersQ.isError && (
                <p className="text-xs text-muted-foreground">
                  Owners could not be loaded (admin-only).
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-[auto_1fr_1fr] items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="show-priority">Priority</Label>
              <Input
                id="show-priority"
                type="number"
                className="w-20"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="show-date-start">From (optional)</Label>
              <Input
                id="show-date-start"
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="show-date-end">Until (optional)</Label>
              <Input
                id="show-date-end"
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
              />
            </div>
          </div>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        <DialogFooter className="gap-2 sm:justify-between">
          {isEdit ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  aria-label="Delete show"
                >
                  <Trash2 />
                  Delete show
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this show?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the show from the schedule. Auto-DJ fills the freed time. This
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="border border-destructive bg-transparent text-destructive hover:bg-destructive/10"
                    onClick={onDelete}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {isEdit ? "Save show" : "Create show"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
