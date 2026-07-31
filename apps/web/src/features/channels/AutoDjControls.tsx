import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorNote } from "@/components/error-note";
import { cn } from "@/lib/utils";
import type { ChannelDto } from "@aerial/shared";
import { useClocks, useSetDefaultClock, useSetEnforceSchedule } from "./hooks";
import { NONE_CLOCK, clockSelectPayload, clockSelectValue } from "./lib";
import { PlayoutLogDialog } from "./PlayoutLogDialog";

/**
 * Channel-level Auto-DJ controls (plan Phase E): the default clock that fills
 * unscheduled time (ADR D17), the schedule-enforcement toggle for streamer auth
 * (ADR D18), and the "why this track" playout-log disclosure. Admin-only mutations
 * are gated server-side (403 for streamers); the controls stay visible and surface
 * the error rather than hiding.
 */
export function AutoDjControls({ channel }: { channel: ChannelDto }) {
  const clocks = useClocks();
  const setDefaultClock = useSetDefaultClock();
  const setEnforce = useSetEnforceSchedule();
  const [logOpen, setLogOpen] = useState(false);

  // The backend Channel row / updateChannelSchema carry these; ChannelDto doesn't
  // surface them yet, so default gracefully to the DB defaults (no clock / enforced).
  const enforce = channel.enforceSchedule ?? true;
  const error = (setDefaultClock.error ?? setEnforce.error) as Error | null;

  return (
    <div className="mt-3 grid gap-3">
      <strong className="text-sm">Auto-DJ</strong>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-muted-foreground">
          Default clock — fills unscheduled time and covers an absent live streamer
        </span>
        <Select
          value={clockSelectValue(channel.defaultClockId)}
          onValueChange={(v) =>
            setDefaultClock.mutate({ id: channel.id, defaultClockId: clockSelectPayload(v) })
          }
        >
          <SelectTrigger aria-label="Default clock" className="h-9 w-full max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_CLOCK}>None — silence when nothing scheduled</SelectItem>
            {(clocks.data ?? []).map((k) => (
              <SelectItem key={k.id} value={k.id}>
                {k.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enforce}
          aria-label="Enforce schedule"
          disabled={setEnforce.isPending}
          onClick={() => setEnforce.mutate({ id: channel.id, enforceSchedule: !enforce })}
          className={cn(
            "mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            enforce ? "justify-end border-primary bg-primary/80" : "justify-start border-border bg-input-surface",
          )}
        >
          <span className="mx-0.5 inline-block size-4 rounded-full bg-background" />
        </button>
        <div className="grid gap-0.5">
          <span className="text-[13px] font-medium">Enforce schedule</span>
          <span className="text-xs text-muted-foreground">
            On: a streamer may go live only during a live show scheduled on this channel.
            Off: any valid streamer key connects anytime (advisory).
          </span>
        </div>
      </div>

      <div>
        <Button variant="outline" size="sm" onClick={() => setLogOpen(true)}>
          Playout log
        </Button>
      </div>

      {error && <ErrorNote>{error.message}</ErrorNote>}

      <PlayoutLogDialog
        channelId={channel.id}
        channelName={channel.name}
        open={logOpen}
        onOpenChange={setLogOpen}
      />
    </div>
  );
}
