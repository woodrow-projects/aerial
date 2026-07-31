import { beforeEach, describe, expect, it, vi } from "vitest";

// The @Roles decorator is owned by the auth agent; mock it so this unit test
// never depends on that file existing on disk (it is metadata-only anyway).
vi.mock("../auth/roles", () => ({ Roles: () => () => undefined, RolesGuard: class {} }));

import { ClocksController } from "./clocks.controller";
import type { ClocksService } from "./clocks.service";

function deps() {
  const service = {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  const controller = new ClocksController(service as unknown as ClocksService);
  return { service, controller };
}

describe("ClocksController", () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => {
    d = deps();
  });

  it("list/get delegate straight through", () => {
    d.controller.list();
    d.controller.get("c1");
    expect(d.service.list).toHaveBeenCalledOnce();
    expect(d.service.get).toHaveBeenCalledWith("c1");
  });

  it("create/update/remove delegate to the service", () => {
    const body = { name: "Daytime", slots: [{ position: 0, playlistId: "p1", count: 1 }] } as never;
    d.controller.create(body);
    d.controller.update("c1", body);
    d.controller.remove("c1");
    expect(d.service.create).toHaveBeenCalledWith(body);
    expect(d.service.update).toHaveBeenCalledWith("c1", body);
    expect(d.service.remove).toHaveBeenCalledWith("c1");
  });
});
