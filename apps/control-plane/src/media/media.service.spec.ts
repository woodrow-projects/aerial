import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { Readable } from "node:stream";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";

// The media volume for these tests is a real temp dir (the service streams to disk);
// mock env so `env.engine.mediaRoot` points there. Created in a hoisted block so the
// path is available to the vi.mock factory (which is hoisted above imports).
const { mediaRoot } = vi.hoisted(() => {
  const fs = require("node:fs");
  const os = require("node:os");
  const p = require("node:path");
  return { mediaRoot: fs.mkdtempSync(p.join(os.tmpdir(), "aerial-media-test-")) };
});
vi.mock("../config/env", () => ({
  env: { engine: { mediaRoot }, media: { uploadMaxMb: 200 } },
}));

// ffprobe is exercised in its own spec; here it is mocked so the unit stays pure.
vi.mock("./ffprobe", () => ({ ffprobe: vi.fn() }));

import { ffprobe } from "./ffprobe";
import { MediaService } from "./media.service";

const ffprobeMock = vi.mocked(ffprobe);

function makeService() {
  const track = {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const prisma = { track } as never;
  const service = new MediaService(prisma);
  return { service, track };
}

/** A full Track row as Prisma would return it (defaults applied). */
function trackRow(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    fileName: "song-abcd1234.mp3",
    title: "Title",
    artist: "Artist",
    album: "Album",
    durationSec: 123,
    cueIn: 0,
    cueOut: null,
    fadeIn: 0,
    fadeOut: 0,
    amplifyDb: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...over,
  };
}

function upload(originalName: string, content = "AUDIO-BYTES") {
  return { originalName, stream: Readable.from(Buffer.from(content)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Empty the media dir between tests (keep the dir itself).
  for (const f of readdirSync(mediaRoot)) rmSync(path.join(mediaRoot, f), { force: true });
});

afterAll(() => rmSync(mediaRoot, { recursive: true, force: true }));

describe("MediaService.create (upload)", () => {
  it("streams the file to the media volume, ffprobes it, and creates a Track", async () => {
    const { service, track } = makeService();
    ffprobeMock.mockResolvedValue({ durationSec: 12.5, title: "Real Title", artist: "A", album: "B" });
    track.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      trackRow({ ...data }),
    );

    const out = await service.create(upload("My Song.mp3"));

    // exactly one file, safely named, written to the media root with the original bytes
    const files = readdirSync(mediaRoot);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^my-song-[0-9a-f]{8}\.mp3$/);
    expect(readFileSync(path.join(mediaRoot, files[0]), "utf8")).toBe("AUDIO-BYTES");

    // ffprobe was handed the absolute path of the stored file
    expect(ffprobeMock).toHaveBeenCalledWith(path.join(mediaRoot, files[0]));

    // the Track row carries the probed metadata + the generated fileName
    expect(track.create).toHaveBeenCalledWith({
      data: {
        fileName: files[0],
        title: "Real Title",
        artist: "A",
        album: "B",
        durationSec: 12.5,
      },
    });
    expect(out).toMatchObject({ fileName: files[0], title: "Real Title", durationSec: 12.5 });
  });

  it("falls back to the original filename (minus extension) when ffprobe has no title", async () => {
    const { service, track } = makeService();
    ffprobeMock.mockResolvedValue({ durationSec: 10, title: null, artist: null, album: null });
    track.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => trackRow({ ...data }));

    await service.create(upload("Untitled Track.flac"));

    expect(track.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "Untitled Track", artist: null, album: null }),
      }),
    );
  });

  it("rejects a disallowed extension with 415 and writes nothing", async () => {
    const { service, track } = makeService();

    await expect(service.create(upload("malware.exe"))).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );

    expect(track.create).not.toHaveBeenCalled();
    expect(ffprobeMock).not.toHaveBeenCalled();
    expect(readdirSync(mediaRoot)).toHaveLength(0);
  });

  it("on ffprobe failure, unlinks the uploaded file and throws 422", async () => {
    const { service, track } = makeService();
    ffprobeMock.mockRejectedValue(new Error("corrupt/unreadable media"));

    await expect(service.create(upload("song.mp3"))).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );

    expect(track.create).not.toHaveBeenCalled();
    expect(readdirSync(mediaRoot)).toHaveLength(0); // cleaned up
  });

  it("never derives the stored name from a client path (traversal-safe naming)", async () => {
    const { service, track } = makeService();
    ffprobeMock.mockResolvedValue({ durationSec: 5, title: null, artist: null, album: null });
    track.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => trackRow({ ...data }));

    await service.create(upload("../../../../etc/passwd.mp3"));

    const files = readdirSync(mediaRoot);
    expect(files).toHaveLength(1);
    const name = files[0];
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
    expect(name).toMatch(/^passwd-[0-9a-f]{8}\.mp3$/);
    // the resolved write path stays inside the media root
    const stored = (track.create.mock.calls[0][0] as { data: { fileName: string } }).data.fileName;
    expect(path.resolve(mediaRoot, stored).startsWith(path.resolve(mediaRoot) + path.sep)).toBe(true);
  });

  it("unlinks the partial file if the upload stream errors mid-write", async () => {
    const { service, track } = makeService();
    const broken = new Readable({
      read() {
        this.destroy(new Error("stream boom"));
      },
    });

    await expect(service.create({ originalName: "x.mp3", stream: broken })).rejects.toThrow("stream boom");

    expect(track.create).not.toHaveBeenCalled();
    expect(readdirSync(mediaRoot)).toHaveLength(0);
  });

  it("maps a file-size-limit stream error to 413 and cleans up", async () => {
    const { service } = makeService();
    const tooBig = new Readable({
      read() {
        this.destroy(Object.assign(new Error("request file too large"), { code: "FST_REQ_FILE_TOO_LARGE" }));
      },
    });

    await expect(service.create({ originalName: "big.mp3", stream: tooBig })).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(readdirSync(mediaRoot)).toHaveLength(0);
  });
});

describe("MediaService.list", () => {
  it("returns all tracks as DTOs ordered by title", async () => {
    const { service, track } = makeService();
    track.findMany.mockResolvedValue([trackRow()]);

    const out = await service.list();

    expect(track.findMany).toHaveBeenCalledWith({ orderBy: { title: "asc" } });
    expect(out).toEqual([
      {
        id: "t1",
        fileName: "song-abcd1234.mp3",
        title: "Title",
        artist: "Artist",
        album: "Album",
        durationSec: 123,
        cueIn: 0,
        cueOut: null,
        fadeIn: 0,
        fadeOut: 0,
        amplifyDb: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });
});

describe("MediaService.update (metadata patch)", () => {
  it("applies only the provided fields, preserving explicit nulls (clearing artist/cueOut)", async () => {
    const { service, track } = makeService();
    track.findUnique.mockResolvedValue(trackRow());
    track.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => trackRow({ ...data }));

    await service.update("t1", { title: "New", artist: null, cueOut: 5 });

    expect(track.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { title: "New", artist: null, cueOut: 5 },
    });
  });

  it("throws 404 when the track does not exist", async () => {
    const { service, track } = makeService();
    track.findUnique.mockResolvedValue(null);

    await expect(service.update("missing", { title: "x" })).rejects.toBeInstanceOf(NotFoundException);
    expect(track.update).not.toHaveBeenCalled();
  });
});

describe("MediaService.remove (delete)", () => {
  it("deletes the row (cascading playlist membership) and unlinks the file", async () => {
    const { service, track } = makeService();
    const fileName = "gone-deadbeef.mp3";
    writeFileSync(path.join(mediaRoot, fileName), "data");
    track.findUnique.mockResolvedValue(trackRow({ fileName }));
    track.delete.mockResolvedValue(trackRow({ fileName }));

    await service.remove("t1");

    expect(track.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
    expect(existsSync(path.join(mediaRoot, fileName))).toBe(false);
  });

  it("succeeds even when the file is already gone (best-effort unlink)", async () => {
    const { service, track } = makeService();
    track.findUnique.mockResolvedValue(trackRow({ fileName: "already-missing.mp3" }));
    track.delete.mockResolvedValue({});

    await expect(service.remove("t1")).resolves.toBeUndefined();
    expect(track.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });

  it("throws 404 when the track does not exist", async () => {
    const { service, track } = makeService();
    track.findUnique.mockResolvedValue(null);

    await expect(service.remove("missing")).rejects.toBeInstanceOf(NotFoundException);
    expect(track.delete).not.toHaveBeenCalled();
  });
});
