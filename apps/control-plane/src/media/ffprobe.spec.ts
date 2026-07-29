import { describe, expect, it, vi, beforeEach } from "vitest";

// ffprobe shells out to the `ffprobe` binary (shipped in the control-plane image).
// The unit under test is pure: the child process is mocked, no real ffprobe runs.
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import { ffprobe } from "./ffprobe";

const execFileMock = vi.mocked(execFile);

/** Make execFile invoke its callback with the given ffprobe stdout (JSON string). */
function stdoutIs(json: string): void {
  execFileMock.mockImplementation(((_bin: string, _args: string[], _opts: unknown, cb: unknown) => {
    (cb as (e: unknown, out: string, err: string) => void)(null, json, "");
    return {} as never;
  }) as never);
}

/** Make execFile invoke its callback with a spawn/exit error (non-zero exit, ENOENT, …). */
function failsWith(err: Error): void {
  execFileMock.mockImplementation(((_bin: string, _args: string[], _opts: unknown, cb: unknown) => {
    (cb as (e: unknown, out: string, err: string) => void)(err, "", "boom");
    return {} as never;
  }) as never);
}

describe("ffprobe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses duration + title/artist/album from ffprobe's format tags", async () => {
    stdoutIs(
      JSON.stringify({
        format: { duration: "183.52", tags: { title: "Song", artist: "Band", album: "LP" } },
      }),
    );

    const out = await ffprobe("/srv/media/song-abcd1234.mp3");

    expect(out).toEqual({ durationSec: 183.52, title: "Song", artist: "Band", album: "LP" });
    // the exact file path must be forwarded to ffprobe as an argument
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args).toContain("/srv/media/song-abcd1234.mp3");
  });

  it("normalizes upper-case tag keys (FLAC/Ogg emit TITLE/ARTIST)", async () => {
    stdoutIs(JSON.stringify({ format: { duration: "10", tags: { TITLE: "S", ARTIST: "A" } } }));

    const out = await ffprobe("/srv/media/x.flac");

    expect(out).toEqual({ durationSec: 10, title: "S", artist: "A", album: null });
  });

  it("returns null tags when metadata is absent, and empty/whitespace tags become null", async () => {
    stdoutIs(JSON.stringify({ format: { duration: "42", tags: { title: "   " } } }));

    const out = await ffprobe("/srv/media/x.wav");

    expect(out).toEqual({ durationSec: 42, title: null, artist: null, album: null });
  });

  it("rejects when the ffprobe process errors (non-zero exit / not found)", async () => {
    failsWith(new Error("ffprobe: command not found"));
    await expect(ffprobe("/srv/media/x.mp3")).rejects.toThrow();
  });

  it("rejects when ffprobe emits non-JSON output", async () => {
    stdoutIs("this is not json");
    await expect(ffprobe("/srv/media/x.mp3")).rejects.toThrow(/json/i);
  });

  it("rejects when no usable duration is present (empty/corrupt media)", async () => {
    stdoutIs(JSON.stringify({ format: { tags: { title: "T" } } }));
    await expect(ffprobe("/srv/media/x.mp3")).rejects.toThrow(/duration/i);
  });
});
