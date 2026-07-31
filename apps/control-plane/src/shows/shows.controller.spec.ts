import { beforeEach, describe, expect, it, vi } from "vitest";

// @Roles is owned by the auth agent; mock it so this unit never depends on the
// file existing on disk (it is metadata-only anyway) — mirrors clocks.controller.spec.
vi.mock("../auth/roles", () => ({ Roles: () => () => undefined, RolesGuard: class {} }));

import { ShowsController } from "./shows.controller";
import type { ShowsService } from "./shows.service";
import type { ScheduleService } from "./schedule.service";

function deps() {
  const shows = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
  const schedule = { nowNext: vi.fn() };
  const controller = new ShowsController(
    shows as unknown as ShowsService,
    schedule as unknown as ScheduleService,
  );
  return { shows, schedule, controller };
}

describe("ShowsController", () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => {
    d = deps();
  });

  it("CRUD routes delegate to ShowsService with the channelId from the route", () => {
    const body = { type: "scheduled", title: "X", startTime: "10:00", endTime: "12:00", clockId: "c1", daysOfWeek: [1], priority: 0 } as never;
    d.controller.list("ch1");
    d.controller.get("ch1", "s1");
    d.controller.create("ch1", body);
    d.controller.update("ch1", "s1", { title: "Y" } as never);
    d.controller.remove("ch1", "s1");
    expect(d.shows.list).toHaveBeenCalledWith("ch1");
    expect(d.shows.get).toHaveBeenCalledWith("ch1", "s1");
    expect(d.shows.create).toHaveBeenCalledWith("ch1", body);
    expect(d.shows.update).toHaveBeenCalledWith("ch1", "s1", { title: "Y" });
    expect(d.shows.remove).toHaveBeenCalledWith("ch1", "s1");
  });

  it("schedule passes the provided `at` through to ScheduleService", () => {
    const at = new Date(2026, 6, 20, 11, 0);
    d.controller.scheduleNowNext("ch1", { at });
    expect(d.schedule.nowNext).toHaveBeenCalledWith("ch1", at);
  });

  it("schedule defaults to now when `at` is omitted", () => {
    d.controller.scheduleNowNext("ch1", {});
    expect(d.schedule.nowNext).toHaveBeenCalledWith("ch1", expect.any(Date));
  });
});
