import { describe, it, expect } from "vitest";
import { NONE_CLOCK, clockSelectValue, clockSelectPayload, playlogTitle } from "./lib";

describe("clockSelectValue / clockSelectPayload (the null default-clock round-trip)", () => {
  it("maps a null or absent default clock to the sentinel the Select can render", () => {
    // Radix Select cannot hold an empty/null value, so 'no clock' becomes a sentinel.
    expect(clockSelectValue(null)).toBe(NONE_CLOCK);
    expect(clockSelectValue(undefined)).toBe(NONE_CLOCK);
  });

  it("passes a real clock id through unchanged", () => {
    expect(clockSelectValue("k1")).toBe("k1");
  });

  it("maps the sentinel back to null for the PATCH payload (clears the clock)", () => {
    expect(clockSelectPayload(NONE_CLOCK)).toBeNull();
  });

  it("passes a real clock id through as the payload", () => {
    expect(clockSelectPayload("k2")).toBe("k2");
  });
});

describe("playlogTitle (the 'what played' label derived from the annotate URI)", () => {
  it("extracts the annotate title= value", () => {
    const uri = 'annotate:liq_cue_in="1.5",title="Morning Song",artist="The Band":/srv/media/a.mp3';
    expect(playlogTitle(uri)).toBe("Morning Song");
  });

  it("un-escapes quotes and backslashes inside the title", () => {
    const uri = 'annotate:title="She said \\"hi\\"",artist="X":/srv/media/a.mp3';
    expect(playlogTitle(uri)).toBe('She said "hi"');
  });

  it("falls back to the file basename when there is no title annotation", () => {
    const uri = 'annotate:liq_cue_in="1":/srv/media/no-title-here.mp3';
    expect(playlogTitle(uri)).toBe("no-title-here.mp3");
  });

  it("falls back to the basename of a bare path", () => {
    expect(playlogTitle("/srv/media/plain.mp3")).toBe("plain.mp3");
  });

  it("returns a placeholder for an empty uri", () => {
    expect(playlogTitle("")).toBe("Unknown track");
  });
});
