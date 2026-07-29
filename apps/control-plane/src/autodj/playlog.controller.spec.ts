import { beforeEach, describe, expect, it, vi } from "vitest";

// The @Roles decorator (auth agent) is not needed here — the playlog read is open
// to any signed-in operator — but the controller module may import it transitively;
// mock it so this unit never depends on that file existing (cf. clocks.controller.spec).
vi.mock("../auth/roles", () => ({ Roles: () => () => undefined }));
// ScheduleService is a DI type on NextTrackService; stub the module so importing the
// controller (which imports the service) never fails resolution during a scoped run.
vi.mock("../shows/schedule.service", () => ({ ScheduleService: class {} }));

import { PlaylogController } from "./playlog.controller";
import type { NextTrackService } from "./next-track.service";

function deps() {
  const service = { playlog: vi.fn() };
  const controller = new PlaylogController(service as unknown as NextTrackService);
  return { service, controller };
}

describe("PlaylogController", () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => {
    d = deps();
  });

  it("delegates to the service with the channel id and the raw limit query", () => {
    d.controller.playlog("ch1", "50");
    expect(d.service.playlog).toHaveBeenCalledWith("ch1", "50");
  });

  it("passes an omitted limit through as undefined (service applies the default)", () => {
    d.controller.playlog("ch1", undefined);
    expect(d.service.playlog).toHaveBeenCalledWith("ch1", undefined);
  });
});
