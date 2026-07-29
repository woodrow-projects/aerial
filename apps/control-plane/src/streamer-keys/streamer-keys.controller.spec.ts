import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamerKeysController } from "./streamer-keys.controller";
import { RolesGuard } from "../auth/roles";
import type { StreamerKeysService } from "./streamer-keys.service";

/**
 * Per-user streamer-key endpoints (admin-only). Delegation is asserted directly;
 * the admin-only contract is proven by running the real RolesGuard against the real
 * @Roles("admin") metadata on a representative mutation.
 */
function deps() {
  const service = { create: vi.fn(), revoke: vi.fn() };
  const controller = new StreamerKeysController(service as unknown as StreamerKeysService);
  return { service, controller };
}

function ctxFor(handler: (...a: never[]) => unknown, role: string): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => StreamerKeysController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as unknown as ExecutionContext;
}

describe("StreamerKeysController", () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => {
    d = deps();
  });

  it("POST streamer-key delegates to StreamerKeysService.create(userId)", () => {
    d.controller.create("u1");
    expect(d.service.create).toHaveBeenCalledWith("u1");
  });

  it("DELETE streamer-key delegates to StreamerKeysService.revoke(userId)", () => {
    d.controller.revoke("u1");
    expect(d.service.revoke).toHaveBeenCalledWith("u1");
  });

  it("issuing a key is admin-only: a streamer is denied (403), an admin is allowed", () => {
    const guard = new RolesGuard(new Reflector());
    expect(() => guard.canActivate(ctxFor(StreamerKeysController.prototype.create, "streamer"))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(ctxFor(StreamerKeysController.prototype.create, "admin"))).toBe(true);
  });
});
