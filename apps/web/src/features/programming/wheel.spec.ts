import { describe, it, expect } from "vitest";
import { computeWedges, type WheelSlot } from "./wheel";

const slot = (over: Partial<WheelSlot>): WheelSlot => ({
  position: 0,
  playlistId: "p",
  playlistName: "P",
  count: 1,
  ...over,
});

describe("computeWedges", () => {
  it("returns no wedges for an empty clock", () => {
    expect(computeWedges([])).toEqual([]);
  });

  it("splits the circle into equal spans when counts are equal", () => {
    const wedges = computeWedges([
      slot({ position: 0, playlistId: "a", playlistName: "A" }),
      slot({ position: 1, playlistId: "b", playlistName: "B" }),
    ]);
    expect(wedges).toHaveLength(2);
    expect(wedges[0].startAngle).toBe(0);
    expect(wedges[0].endAngle).toBe(180);
    expect(wedges[0].midAngle).toBe(90);
    expect(wedges[1].startAngle).toBe(180);
    expect(wedges[1].endAngle).toBe(360);
  });

  it("sizes each wedge proportionally to its track count (airtime)", () => {
    const wedges = computeWedges([
      slot({ position: 0, playlistId: "a", count: 3 }),
      slot({ position: 1, playlistId: "b", count: 1 }),
    ]);
    expect(wedges[0].endAngle).toBe(270);
    expect(wedges[1].startAngle).toBe(270);
    expect(wedges[1].endAngle).toBe(360);
  });

  it("carries slot identity through and emits a drawable arc + finite label point", () => {
    const [w] = computeWedges([slot({ position: 0, playlistId: "a", playlistName: "Currents", count: 2 })]);
    expect(w.playlistId).toBe("a");
    expect(w.playlistName).toBe("Currents");
    expect(w.count).toBe(2);
    expect(w.position).toBe(0);
    expect(w.path.startsWith("M")).toBe(true);
    expect(Number.isFinite(w.labelX)).toBe(true);
    expect(Number.isFinite(w.labelY)).toBe(true);
  });
});
