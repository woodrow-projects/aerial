import type { Channel } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { EngineService } from "./engine.service";
import type { LiquidsoapParams } from "./liq-template";

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "c1",
    name: "Main",
    slug: "main",
    mount: "/main",
    isActive: true,
    deliveryMode: "hls",
    harborPort: 8100,
    hlsBitrates: "[48,96,192]", // stored as JSON text (SQLite has no scalar lists)
    icecastBitrate: 128,
    createdAt: new Date("2026-06-18T00:00:00Z"),
    updatedAt: new Date("2026-06-18T00:00:00Z"),
    ...overrides,
  };
}

describe("EngineService buildParams column decoding", () => {
  it("decodes the stored deliveryMode and hlsBitrates columns for the Liquidsoap template", () => {
    const svc = new EngineService(undefined as never);
    const params = (
      svc as unknown as { buildParams: (c: Channel) => LiquidsoapParams }
    ).buildParams(makeChannel());
    expect(params.deliveryMode).toBe("hls");
    expect(params.hlsBitrates).toEqual([48, 96, 192]);
  });

  it("fails loudly on a corrupt hlsBitrates column instead of templating garbage", () => {
    const svc = new EngineService(undefined as never);
    expect(() =>
      (svc as unknown as { buildParams: (c: Channel) => LiquidsoapParams }).buildParams(
        makeChannel({ hlsBitrates: "oops" }),
      ),
    ).toThrow(/hlsBitrates/);
  });
});
