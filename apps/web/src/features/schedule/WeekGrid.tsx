import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { DAY_LABELS, HOURS, allSegments, minutesToHm, type ShowSegment } from "./lib";
import type { ShowDto } from "./types";

/**
 * The weekly schedule calendar — a 7-day × 24-hour grid. Each show is expanded
 * (via `allSegments`) into positioned blocks: same-day shows get one block per
 * aired day; overnight shows get a head block to midnight plus a wrapped tail on
 * the next day (Saturday → Sunday), flagged "(cont.)". Blocks are colour-coded by
 * type (scheduled vs live) with the show's clock or owner name, and clicking one
 * opens the inline editor. All the placement math is the pure `lib.ts` (unit-tested);
 * this component only renders what it returns.
 */
export function WeekGrid({
  shows,
  onSelectShow,
  clocksById,
  usersById,
}: {
  shows: ShowDto[];
  onSelectShow: (show: ShowDto) => void;
  clocksById?: Record<string, string>;
  usersById?: Record<string, string>;
}) {
  const byDay = useMemo(() => {
    const buckets: ShowSegment[][] = Array.from({ length: 7 }, () => []);
    for (const seg of allSegments(shows)) buckets[seg.day].push(seg);
    return buckets;
  }, [shows]);

  const secondary = (seg: ShowSegment): string => {
    if (seg.show.type === "live") {
      return (seg.show.ownerId && usersById?.[seg.show.ownerId]) || "Live";
    }
    return (seg.show.clockId && clocksById?.[seg.show.clockId]) || "Auto-DJ program";
  };

  const label = (seg: ShowSegment): string =>
    `${seg.show.title}, ${DAY_LABELS[seg.day]} ${seg.show.startTime}–${seg.show.endTime}` +
    (seg.isContinuation ? " (continues)" : "");

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="relative min-w-[760px]">
        {/* Header row: weekday names. */}
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-border bg-card">
          <div />
          {DAY_LABELS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* Body: hour gutter + 7 day columns. */}
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)]">
          <div className="relative h-[720px]">
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: `${(h / 24) * 100}%` }}
              >
                {minutesToHm(h * 60)}
              </div>
            ))}
          </div>

          {DAY_LABELS.map((dayLabel, day) => (
            <div key={dayLabel} className="relative h-[720px] border-l border-border">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-border"
                  style={{ top: `${(h / 24) * 100}%` }}
                />
              ))}

              {byDay[day].map((seg) => (
                <button
                  key={seg.key}
                  type="button"
                  data-testid="show-block"
                  onClick={() => onSelectShow(seg.show)}
                  aria-label={label(seg)}
                  style={{ top: `${seg.topPct}%`, height: `${seg.heightPct}%` }}
                  className={cn(
                    "absolute inset-x-0.5 z-10 overflow-hidden rounded-md border px-1.5 py-1 text-left leading-tight transition-colors",
                    seg.show.type === "live"
                      ? "border-live/60 bg-live/15 hover:bg-live/25"
                      : "border-primary/50 bg-primary/15 hover:bg-primary/25",
                  )}
                >
                  <span className="block truncate text-xs font-medium text-foreground">
                    {seg.show.title}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {secondary(seg)}
                  </span>
                  {seg.isContinuation && (
                    <span className="block text-[10px] text-muted-foreground">(cont.)</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        {shows.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-md border border-border bg-card/90 px-3 py-2 text-sm text-muted-foreground">
              No shows scheduled — Auto-DJ fills the whole week.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
