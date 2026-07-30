import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import type { ClockDto } from "./types";
import { useClocks, useDeleteClock } from "./hooks";
import { ClockwheelEditor } from "./ClockwheelEditor";

/**
 * Clocks section of the programming screen: every install-level clockwheel with
 * its slot count, plus create/edit (the clockwheel editor) and delete. A delete
 * blocked because a channel default-clock or a scheduled show references the clock
 * surfaces the server's 409 (which names the referrers) inline.
 */
export function ClocksPanel() {
  const clocks = useClocks();
  const list = clocks.data ?? [];
  const del = useDeleteClock();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClockDto | null>(null);

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Clockwheels</h2>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          New clock
        </Button>
      </div>

      {clocks.error && <ErrorNote>{(clocks.error as Error).message}</ErrorNote>}
      {del.error && <ErrorNote>{(del.error as Error).message}</ErrorNote>}

      {clocks.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">No clockwheels yet. Create your first one above.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slots</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.slotCount}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(c)}
                      aria-label={`Edit ${c.name}`}
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
                          aria-label={`Delete ${c.name}`}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete clock “{c.name}”?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the clockwheel and its slots. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="border border-destructive bg-transparent text-destructive hover:bg-destructive/10"
                            onClick={() => del.mutate(c.id)}
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

      {creating && <ClockwheelEditor open onOpenChange={(o) => !o && setCreating(false)} />}
      {editing && (
        <ClockwheelEditor open clock={editing} onOpenChange={(o) => !o && setEditing(null)} />
      )}
    </div>
  );
}
