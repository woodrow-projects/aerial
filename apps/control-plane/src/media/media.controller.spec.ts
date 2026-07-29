import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { Readable } from "node:stream";
import { createTrackMetaSchema } from "@aerial/shared";

// @Roles is owned by the auth agent; mock it so this unit never depends on that file
// existing on disk (it is metadata-only anyway).
vi.mock("../auth/roles", () => ({ Roles: () => () => undefined }));

import { MediaController } from "./media.controller";
import type { MediaService } from "./media.service";

function deps() {
  const service = { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
  const controller = new MediaController(service as unknown as MediaService);
  return { service, controller };
}

describe("MediaController", () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => {
    d = deps();
  });

  it("list/update/remove delegate straight to the service", () => {
    const body = { title: "New" } as never;
    d.controller.list();
    d.controller.update("t1", body);
    d.controller.remove("t1");
    expect(d.service.list).toHaveBeenCalledOnce();
    expect(d.service.update).toHaveBeenCalledWith("t1", body);
    expect(d.service.remove).toHaveBeenCalledWith("t1");
  });

  it("upload pulls the multipart file and forwards its name + stream to the service", async () => {
    const stream = Readable.from(Buffer.from("x"));
    const req = { file: vi.fn().mockResolvedValue({ filename: "Song.mp3", file: stream }) };

    await d.controller.upload(req as never);

    expect(req.file).toHaveBeenCalledOnce();
    expect(d.service.create).toHaveBeenCalledWith({ originalName: "Song.mp3", stream });
  });

  it("upload rejects with 400 when no file part is present", async () => {
    const req = { file: vi.fn().mockResolvedValue(undefined) };
    await expect(d.controller.upload(req as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(d.service.create).not.toHaveBeenCalled();
  });
});

// The metadata PATCH body is validated by createTrackMetaSchema (shared) via
// ZodValidationPipe. Pin the contract the controller relies on.
describe("createTrackMetaSchema (metadata patch validation)", () => {
  it("accepts a partial patch, including explicit nulls to clear fields", () => {
    const out = createTrackMetaSchema.parse({ title: "New", artist: null, cueOut: null });
    expect(out).toEqual({ title: "New", artist: null, cueOut: null });
  });

  it("accepts an empty patch (no-op)", () => {
    expect(createTrackMetaSchema.parse({})).toEqual({});
  });

  it("rejects an empty title and negative cue/fade values", () => {
    expect(createTrackMetaSchema.safeParse({ title: "" }).success).toBe(false);
    expect(createTrackMetaSchema.safeParse({ cueIn: -1 }).success).toBe(false);
    expect(createTrackMetaSchema.safeParse({ fadeIn: -0.5 }).success).toBe(false);
  });
});
