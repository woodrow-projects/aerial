import { describe, it, expect } from "vitest";
import {
  formatDuration,
  buildQueue,
  setItemStatus,
  firstPending,
  describeUploadError,
  buildTrackMetaPayload,
  formFromTrack,
  type TrackMetaForm,
} from "./lib";
import type { TrackDto } from "./api";

const file = (name: string) => new File(["x"], name, { type: "audio/mpeg" });

describe("formatDuration", () => {
  it("formats sub-minute and minute durations as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(599)).toBe("9:59");
  });

  it("formats hour-plus durations as h:mm:ss", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("rounds fractional seconds to the nearest second", () => {
    expect(formatDuration(125.4)).toBe("2:05");
    expect(formatDuration(125.6)).toBe("2:06");
  });

  it("coerces NaN / negative / infinite to 0:00", () => {
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(-10)).toBe("0:00");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("upload queue", () => {
  it("builds a pending item per file, preserving order and names", () => {
    const q = buildQueue([file("a.mp3"), file("b.flac")]);
    expect(q.map((i) => i.name)).toEqual(["a.mp3", "b.flac"]);
    expect(q.every((i) => i.status === "pending")).toBe(true);
    expect(new Set(q.map((i) => i.id)).size).toBe(2); // ids are unique
  });

  it("setItemStatus updates only the matching item and carries an error message", () => {
    const q = buildQueue([file("a.mp3"), file("b.mp3")]);
    const uploading = setItemStatus(q, q[0].id, "uploading");
    expect(uploading[0].status).toBe("uploading");
    expect(uploading[1].status).toBe("pending"); // untouched

    const errored = setItemStatus(uploading, q[1].id, "error", "boom");
    expect(errored[1]).toMatchObject({ status: "error", error: "boom" });
    expect(errored[0].status).toBe("uploading");
  });

  it("firstPending returns the next pending item, or undefined when none remain", () => {
    const q = buildQueue([file("a.mp3"), file("b.mp3")]);
    expect(firstPending(q)?.name).toBe("a.mp3");
    const done = setItemStatus(q, q[0].id, "done");
    expect(firstPending(done)?.name).toBe("b.mp3");
    const allDone = setItemStatus(done, q[1].id, "done");
    expect(firstPending(allDone)).toBeUndefined();
  });
});

describe("describeUploadError", () => {
  it("prefers the server-supplied message (415 extension / 422 ffprobe)", () => {
    expect(describeUploadError({ status: 415, message: 'unsupported media type ".txt"' })).toMatch(
      /unsupported media type/i,
    );
    expect(describeUploadError({ status: 422, message: "ffprobe failed" })).toMatch(/ffprobe/i);
  });

  it("falls back to a friendly label per known status when no message is present", () => {
    expect(describeUploadError({ status: 415 })).toMatch(/unsupported/i);
    expect(describeUploadError({ status: 422 })).toMatch(/metadata|audio/i);
    expect(describeUploadError({})).toMatch(/failed/i);
  });
});

const track: TrackDto = {
  id: "t1",
  fileName: "song-abc123.mp3",
  title: "Song",
  artist: "Artist",
  album: "Album",
  durationSec: 200,
  cueIn: 2,
  cueOut: null,
  fadeIn: 1,
  fadeOut: 3,
  amplifyDb: -1.5,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("formFromTrack", () => {
  it("stringifies numbers and renders a null cueOut as an empty field", () => {
    const form = formFromTrack(track);
    expect(form).toEqual({
      title: "Song",
      artist: "Artist",
      album: "Album",
      cueIn: "2",
      cueOut: "",
      fadeIn: "1",
      fadeOut: "3",
      amplifyDb: "-1.5",
    });
  });

  it("renders null artist/album as empty fields", () => {
    const form = formFromTrack({ ...track, artist: null, album: null });
    expect(form.artist).toBe("");
    expect(form.album).toBe("");
  });
});

describe("buildTrackMetaPayload", () => {
  const base: TrackMetaForm = {
    title: "  New Title  ",
    artist: "  ",
    album: "Records",
    cueIn: "2.5",
    cueOut: "",
    fadeIn: "0",
    fadeOut: "4",
    amplifyDb: "-2",
  };

  it("trims the title, blanks artist to null, and coerces number fields", () => {
    expect(buildTrackMetaPayload(base)).toEqual({
      title: "New Title",
      artist: null, // whitespace-only clears the field
      album: "Records",
      cueIn: 2.5,
      cueOut: null, // blank clears cueOut
      fadeIn: 0,
      fadeOut: 4,
      amplifyDb: -2,
    });
  });

  it("parses a provided cueOut into a number", () => {
    expect(buildTrackMetaPayload({ ...base, cueOut: "180" }).cueOut).toBe(180);
  });
});
