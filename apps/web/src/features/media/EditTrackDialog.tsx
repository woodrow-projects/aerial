import { useCallback, useState } from "react";
import { createTrackMetaSchema } from "@aerial/shared";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/error-note";
import type { TrackDto } from "./api";
import { buildTrackMetaPayload, formFromTrack, PLAYOUT_FIELDS, type TrackMetaForm } from "./lib";
import { useUpdateTrack } from "./hooks";

/**
 * Inline metadata editor. Text fields (title/artist/album) plus the cue/fade/amplify
 * numbers that drive playout — each annotated with a one-line explanation. The form
 * is validated against the shared `createTrackMetaSchema` (the exact contract the
 * server PATCH enforces) before the request; server-side errors surface below.
 */
export function EditTrackDialog({ track }: { track: TrackDto }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TrackMetaForm>(() => formFromTrack(track));
  const [invalid, setInvalid] = useState<string | null>(null);
  const update = useUpdateTrack();

  // Stable identity so the Dialog's memoised setOpen (keyed on onOpenChange) does not
  // change on every keystroke-driven re-render — an unstable handler makes DialogContent's
  // focus effect re-run and steal focus back to the panel mid-typing, dropping characters.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        setForm(formFromTrack(track)); // re-seed from the latest track each time it opens
        setInvalid(null);
      }
    },
    [track],
  );

  const bind = (key: keyof TrackMetaForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value; // capture before the async state update
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = createTrackMetaSchema.safeParse(buildTrackMetaPayload(form));
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? "Please check the values.");
      return;
    }
    setInvalid(null);
    try {
      await update.mutateAsync({ id: track.id, input: parsed.data });
      setOpen(false);
    } catch {
      // surfaced via update.error below
    }
  }

  const fid = (key: string) => `edit-${key}-${track.id}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit track</DialogTitle>
          <DialogDescription>{track.fileName}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor={fid("title")}>Title</Label>
            <Input id={fid("title")} value={form.title} onChange={bind("title")} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={fid("artist")}>Artist</Label>
              <Input id={fid("artist")} value={form.artist} onChange={bind("artist")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={fid("album")}>Album</Label>
              <Input id={fid("album")} value={form.album} onChange={bind("album")} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {PLAYOUT_FIELDS.map((field) => (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={fid(field.key)}>{field.label}</Label>
                <Input
                  id={fid(field.key)}
                  type="number"
                  step="any"
                  value={form[field.key]}
                  onChange={bind(field.key)}
                />
                <p className="text-xs text-muted-foreground">{field.help}</p>
              </div>
            ))}
          </div>

          {invalid && <ErrorNote>{invalid}</ErrorNote>}
          {update.error && <ErrorNote>{(update.error as Error).message}</ErrorNote>}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
