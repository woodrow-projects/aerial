import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersController } from "./users.controller";
import { RolesGuard } from "../auth/roles";
import type { UsersService } from "./users.service";

/**
 * User-management endpoints — admin-only (user/role admin is not a streamer power).
 * Delegation is asserted directly; the admin-only contract is proven by running the
 * real RolesGuard against the real @Roles("admin") metadata on each route.
 */
function deps() {
  const service = { list: vi.fn(), setRole: vi.fn() };
  const controller = new UsersController(service as unknown as UsersService);
  return { service, controller };
}

function ctxFor(handler: (...a: never[]) => unknown, role: string): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => UsersController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as unknown as ExecutionContext;
}

describe("UsersController", () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => {
    d = deps();
  });

  it("GET /api/users delegates to UsersService.list()", () => {
    d.controller.list();
    expect(d.service.list).toHaveBeenCalledOnce();
  });

  it("PATCH :id/role unwraps the validated role and delegates to setRole(id, role)", () => {
    d.controller.setRole("u1", { role: "admin" });
    expect(d.service.setRole).toHaveBeenCalledWith("u1", "admin");
  });

  it("both routes are admin-only: a streamer is denied (403), an admin is allowed", () => {
    const guard = new RolesGuard(new Reflector());
    for (const handler of [UsersController.prototype.list, UsersController.prototype.setRole]) {
      expect(() => guard.canActivate(ctxFor(handler, "streamer"))).toThrow(ForbiddenException);
      expect(guard.canActivate(ctxFor(handler, "admin"))).toBe(true);
    }
  });
});
