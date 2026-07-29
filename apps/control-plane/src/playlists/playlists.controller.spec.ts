import { beforeEach, describe, expect, it, vi } from "vitest";

// The @Roles decorator is owned by the auth agent; mock it so this unit test
// never depends on that file existing on disk (it is metadata-only anyway).
vi.mock("../auth/roles", () => ({ Roles: () => () => undefined }));

import { PlaylistsController } from "./playlists.controller";
import type { PlaylistsService } from "./playlists.service";

function deps() {
  const service = {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setTracks: vi.fn(),
    remove: vi.fn(),
  };
  const controller = new PlaylistsController(service as unknown as PlaylistsService);
  return { service, controller };
}

describe("PlaylistsController", () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => {
    d = deps();
  });

  it("list/get delegate straight through", () => {
    d.controller.list();
    d.controller.get("p1");
    expect(d.service.list).toHaveBeenCalledOnce();
    expect(d.service.get).toHaveBeenCalledWith("p1");
  });

  it("create/update/remove delegate to the service", () => {
    const body = { name: "Currents" } as never;
    d.controller.create(body);
    d.controller.update("p1", body);
    d.controller.remove("p1");
    expect(d.service.create).toHaveBeenCalledWith(body);
    expect(d.service.update).toHaveBeenCalledWith("p1", body);
    expect(d.service.remove).toHaveBeenCalledWith("p1");
  });

  it("setTracks unwraps the trackIds array from the body", () => {
    d.controller.setTracks("p1", { trackIds: ["t1", "t2"] });
    expect(d.service.setTracks).toHaveBeenCalledWith("p1", ["t1", "t2"]);
  });
});
