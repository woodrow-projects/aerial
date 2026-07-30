import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorNote } from "@/components/error-note";
import type { ShowDto } from "./types";
import { useChannels, useClocks, useShows, useUsers } from "./hooks";
import { NowNextStrip } from "./NowNextStrip";
import { WeekGrid } from "./WeekGrid";
import { ShowEditor } from "./ShowEditor";

/**
 * The weekly schedule calendar screen (plan Phase E) — the primary scheduling
 * view. A channel selector drives a 7-day × 24-hour grid of that channel's shows
 * (Auto-DJ fills anything uncovered); a now/next strip shows what is on air.
 * Clicking a show block opens the inline editor; "Add show" opens it empty. Reads
 * are open; all mutations are admin-only server-side (403 for streamers), surfaced
 * inline by the editor.
 */
export function ScheduleScreen() {
  const channelsQ = useChannels();
  const channels = channelsQ.data ?? [];

  const [picked, setPicked] = useState<string | undefined>(undefined);
  const activeId = picked ?? channels[0]?.id;

  const showsQ = useShows(activeId);
  const shows = showsQ.data ?? [];

  // Names for the grid blocks + now/next strip. Clocks are open to read; the users
  // list is admin-only (streamers get a 403 → an empty map, live blocks show "Live").
  const clocks = useClocks().data ?? [];
  const users = useUsers().data ?? [];
  const clocksById = useMemo(() => Object.fromEntries(clocks.map((c) => [c.id, c.name])), [clocks]);
  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])), [users]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ShowDto | null>(null);

  const noChannels = !channelsQ.isLoading && channels.length === 0;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="text-sm text-muted-foreground">
            The week at a glance. Click a show to manage it; Auto-DJ fills the rest.
          </p>
        </div>

        {channels.length > 0 && (
          <div className="flex items-center gap-2">
            <Select value={activeId} onValueChange={setPicked}>
              <SelectTrigger aria-label="Channel" className="w-56">
                <SelectValue placeholder="Select a channel" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setCreating(true)} disabled={!activeId}>
              <Plus />
              Add show
            </Button>
          </div>
        )}
      </div>

      {channelsQ.error && <ErrorNote>{(channelsQ.error as Error).message}</ErrorNote>}
      {showsQ.error && <ErrorNote>{(showsQ.error as Error).message}</ErrorNote>}

      {noChannels ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Create a channel first, then its shows appear here.
        </p>
      ) : (
        activeId && (
          <>
            <NowNextStrip channelId={activeId} clocksById={clocksById} usersById={usersById} />
            <WeekGrid
              shows={shows}
              clocksById={clocksById}
              usersById={usersById}
              onSelectShow={setEditing}
            />
          </>
        )
      )}

      {activeId && creating && (
        <ShowEditor
          channelId={activeId}
          open
          onOpenChange={(o) => !o && setCreating(false)}
        />
      )}
      {activeId && editing && (
        <ShowEditor
          channelId={activeId}
          show={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </div>
  );
}
