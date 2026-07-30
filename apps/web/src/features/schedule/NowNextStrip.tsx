import { Badge } from "@/components/ui/badge";
import type { ResolutionSummary } from "./types";
import { useScheduleNowNext } from "./hooks";

/**
 * The "now / next" strip above the calendar — reads the schedule endpoint's
 * resolved now/next (`GET .../schedule`) and shows what is on air and the next
 * boundary. It refreshes on the hook's interval (now advances on its own) and is
 * invalidated by any show mutation. Clock/owner ids are resolved to names via the
 * maps the screen already loads; unknown ids fall back to a generic label.
 */

/** ISO instant → local "HH:MM" (per-install TZ; server-local wall clock). */
function formatAt(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function nowParts(
  now: ResolutionSummary,
  clocksById?: Record<string, string>,
  usersById?: Record<string, string>,
): { badge: string; variant: "on" | "live" | "default"; primary: string; secondary: string } {
  switch (now.kind) {
    case "live":
      return {
        badge: "Live",
        variant: "live",
        primary: now.showTitle ?? "Live show",
        secondary: (now.ownerId && usersById?.[now.ownerId]) || "Live source",
      };
    case "scheduled":
      return {
        badge: "Scheduled",
        variant: "on",
        primary: now.showTitle ?? "Scheduled show",
        secondary: (now.clockId && clocksById?.[now.clockId]) || "Auto-DJ program",
      };
    default:
      return {
        badge: "Auto-DJ",
        variant: "default",
        primary: (now.clockId && clocksById?.[now.clockId]) || "Default rotation",
        secondary: "Fills unscheduled time",
      };
  }
}

export function NowNextStrip({
  channelId,
  clocksById,
  usersById,
}: {
  channelId: string;
  clocksById?: Record<string, string>;
  usersById?: Record<string, string>;
}) {
  const { data, isLoading } = useScheduleNowNext(channelId);

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
      <div data-testid="now-panel" className="grid gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          On now
        </span>
        {isLoading || !data ? (
          <span className="text-sm text-muted-foreground">Loading…</span>
        ) : (
          (() => {
            const p = nowParts(data.now, clocksById, usersById);
            return (
              <div className="flex items-center gap-2">
                <Badge variant={p.variant}>{p.badge}</Badge>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.primary}</div>
                  <div className="truncate text-xs text-muted-foreground">{p.secondary}</div>
                </div>
              </div>
            );
          })()
        )}
      </div>

      <div data-testid="next-panel" className="grid gap-1 sm:border-l sm:border-border sm:pl-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Up next
        </span>
        {isLoading || !data ? (
          <span className="text-sm text-muted-foreground">Loading…</span>
        ) : data.next === null ? (
          <span className="text-sm text-muted-foreground">
            Nothing scheduled changes in the next 24 hours.
          </span>
        ) : (
          <div className="text-sm">
            <span className="font-medium">{data.next.showTitle}</span>{" "}
            <span className="text-muted-foreground">
              {data.next.boundary === "start" ? "starts" : "ends"} at {formatAt(data.next.at)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
