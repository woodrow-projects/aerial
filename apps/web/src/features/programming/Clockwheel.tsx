import { cn } from "@/lib/utils";
import { computeWedges, WHEEL_VIEWBOX, type WheelSlot } from "./wheel";

/**
 * The clockwheel made visible — the product differentiator. Renders a clock's
 * ordered slots as a repeating ring, each wedge sized by airtime (its `count`
 * share) so the shape of the hour is legible at a glance: a fat Currents wedge,
 * a thin jingle. Pure presentational; all geometry comes from `computeWedges`.
 * Colours cycle a small palette keyed by playlist so a playlist reused across
 * slots reads as the same colour. Theme tokens only (no raw colours).
 */

/** Fill utilities keyed to theme tokens; one per distinct playlist, cycling. */
const FILLS = [
  "fill-primary",
  "fill-live",
  "fill-destructive",
  "fill-muted-foreground",
  "fill-secondary-foreground",
] as const;

export function Clockwheel({ slots, className }: { slots: WheelSlot[]; className?: string }) {
  const wedges = computeWedges(slots);

  // Assign a stable colour index per playlist, in first-seen order.
  const colorIndex = new Map<string, number>();
  for (const s of slots) {
    if (!colorIndex.has(s.playlistId)) colorIndex.set(s.playlistId, colorIndex.size);
  }

  return (
    <svg
      role="img"
      aria-label="Clockwheel preview"
      viewBox={WHEEL_VIEWBOX}
      className={cn("h-auto w-full max-w-[280px]", className)}
    >
      {wedges.length === 0 ? (
        <>
          <circle cx={0} cy={0} r={100} className="fill-none stroke-border" strokeWidth={1} strokeDasharray="4 4" />
          <text x={0} y={0} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground" fontSize={9}>
            No slots yet
          </text>
        </>
      ) : (
        <>
          {wedges.map((w) => {
            const fill = FILLS[(colorIndex.get(w.playlistId) ?? 0) % FILLS.length];
            return (
              <g key={w.position}>
                <path d={w.path} fillRule="evenodd" className={cn(fill, "stroke-card")} strokeWidth={1.5} opacity={0.85} />
                <text
                  x={w.labelX}
                  y={w.labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-foreground"
                  fontSize={8}
                  fontWeight={600}
                >
                  {w.playlistName}
                </text>
              </g>
            );
          })}
          <text x={0} y={-4} textAnchor="middle" dominantBaseline="middle" className="fill-foreground" fontSize={11} fontWeight={700}>
            {wedges.length}
          </text>
          <text x={0} y={8} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground" fontSize={7}>
            {wedges.length === 1 ? "slot" : "slots"}
          </text>
        </>
      )}
    </svg>
  );
}
