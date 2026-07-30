/**
 * Clockwheel geometry — turns a clock's ordered slots into SVG donut wedges sized
 * by *airtime* (a slot's share of the wheel is its `count` over the total count),
 * so a 3-track Currents slot visibly dominates a 1-track jingle. Pure + framework-
 * free so it is unit-testable headless (see wheel.spec.ts); the Clockwheel React
 * component only renders what this returns.
 */

/** The slot fields the wheel needs (a structural subset of ClockSlotDto). */
export interface WheelSlot {
  position: number;
  playlistId: string;
  playlistName: string;
  count: number;
}

/** One drawable wedge: the source slot + its angular span + an SVG arc + a label anchor. */
export interface Wedge extends WheelSlot {
  /** Degrees around the wheel, 0 = 12 o'clock, increasing clockwise. */
  startAngle: number;
  endAngle: number;
  midAngle: number;
  /** `d` for an SVG <path> (a donut wedge; a full ring when the clock has one slot). */
  path: string;
  /** Anchor point (SVG user units) for the wedge's text label, at its mid-angle. */
  labelX: number;
  labelY: number;
}

const R_OUTER = 100;
const R_INNER = 52;
const R_LABEL = (R_OUTER + R_INNER) / 2;

/** Point on a circle of radius `r` at `deg` (0 = top, clockwise), centred at (0,0). */
function polar(deg: number, r: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [r * Math.cos(rad), r * Math.sin(rad)];
}

function fmt(n: number): string {
  // Trim to a stable, compact string; avoids 1e-15 noise in the path.
  return (Math.round(n * 1000) / 1000).toString();
}

/** SVG `d` for a donut wedge from `start`→`end` between the inner and outer radii. */
function wedgePath(start: number, end: number): string {
  const large = end - start > 180 ? 1 : 0;
  const [ox1, oy1] = polar(start, R_OUTER);
  const [ox2, oy2] = polar(end, R_OUTER);
  const [ix2, iy2] = polar(end, R_INNER);
  const [ix1, iy1] = polar(start, R_INNER);
  return [
    `M ${fmt(ox1)} ${fmt(oy1)}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${fmt(ox2)} ${fmt(oy2)}`,
    `L ${fmt(ix2)} ${fmt(iy2)}`,
    `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${fmt(ix1)} ${fmt(iy1)}`,
    "Z",
  ].join(" ");
}

/** SVG `d` for a full ring (single-slot clock) — outer + inner circle, evenodd hole. */
function ringPath(): string {
  const [ox0, oy0] = polar(0, R_OUTER);
  const [ox180, oy180] = polar(180, R_OUTER);
  const [ix0, iy0] = polar(0, R_INNER);
  const [ix180, iy180] = polar(180, R_INNER);
  return [
    `M ${fmt(ox0)} ${fmt(oy0)}`,
    `A ${R_OUTER} ${R_OUTER} 0 1 1 ${fmt(ox180)} ${fmt(oy180)}`,
    `A ${R_OUTER} ${R_OUTER} 0 1 1 ${fmt(ox0)} ${fmt(oy0)}`,
    "Z",
    `M ${fmt(ix0)} ${fmt(iy0)}`,
    `A ${R_INNER} ${R_INNER} 0 1 0 ${fmt(ix180)} ${fmt(iy180)}`,
    `A ${R_INNER} ${R_INNER} 0 1 0 ${fmt(ix0)} ${fmt(iy0)}`,
    "Z",
  ].join(" ");
}

/**
 * Split the wheel into one wedge per slot, each sized proportionally to its
 * `count` (airtime). Slots are drawn in `position` order starting at 12 o'clock,
 * clockwise. An empty clock yields no wedges; a single slot yields a full ring.
 */
export function computeWedges(slots: WheelSlot[]): Wedge[] {
  if (slots.length === 0) return [];

  const ordered = [...slots].sort((a, b) => a.position - b.position);
  const total = ordered.reduce((sum, s) => sum + Math.max(0, s.count), 0) || ordered.length;
  const single = ordered.length === 1;

  const wedges: Wedge[] = [];
  let cursor = 0;
  for (const s of ordered) {
    const span = (Math.max(0, s.count) / total) * 360;
    const startAngle = cursor;
    const endAngle = single ? 360 : cursor + span;
    const midAngle = (startAngle + endAngle) / 2;
    const [labelX, labelY] = polar(midAngle, R_LABEL);
    wedges.push({
      position: s.position,
      playlistId: s.playlistId,
      playlistName: s.playlistName,
      count: s.count,
      startAngle,
      endAngle,
      midAngle,
      path: single ? ringPath() : wedgePath(startAngle, endAngle),
      labelX,
      labelY,
    });
    cursor = endAngle;
  }
  return wedges;
}

/** viewBox the Clockwheel renders into — geometry is centred on (0,0). */
export const WHEEL_VIEWBOX = `${-R_OUTER - 8} ${-R_OUTER - 8} ${(R_OUTER + 8) * 2} ${(R_OUTER + 8) * 2}`;
