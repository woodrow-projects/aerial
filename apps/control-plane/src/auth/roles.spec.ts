import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ROLES, ROLES_KEY, Roles, RolesGuard } from "./roles";

/**
 * RBAC guard (ADR D18). The global AuthGuard attaches `req.user` (with its `role`)
 * before this per-controller guard runs; RolesGuard reads that role and enforces
 * the @Roles(...) metadata. It is deliberately a no-op when a route carries no
 * @Roles metadata (reads stay open to any session), so it is safe whether applied
 * per-controller (@UseGuards) or, later, registered globally.
 */

/** A reflector that reports a fixed metadata result — mirrors auth.guard.spec. */
function reflectorReturning(required: readonly string[] | undefined): Reflector {
  return { getAllAndOverride: vi.fn(() => required) } as unknown as Reflector;
}

/** Minimal ExecutionContext carrying `req.user`. */
function ctx(user: unknown = undefined): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe("Roles decorator + ROLES", () => {
  it("exposes the admin|streamer role tuple", () => {
    expect(ROLES).toEqual(["admin", "streamer"]);
  });

  it("attaches the required roles as ROLES_KEY metadata a real Reflector can read", () => {
    class Target {
      handler(): void {}
    }
    Roles("admin")(
      Target.prototype,
      "handler",
      Object.getOwnPropertyDescriptor(Target.prototype, "handler")!,
    );
    const meta = new Reflector().get<string[]>(ROLES_KEY, Target.prototype.handler);
    expect(meta).toEqual(["admin"]);
  });
});

describe("RolesGuard", () => {
  it("allows a route with no @Roles metadata (reads stay open to any session)", () => {
    const guard = new RolesGuard(reflectorReturning(undefined));
    expect(guard.canActivate(ctx({ role: "streamer" }))).toBe(true);
  });

  it("allows a route with an empty roles list", () => {
    const guard = new RolesGuard(reflectorReturning([]));
    expect(guard.canActivate(ctx({ role: "streamer" }))).toBe(true);
  });

  it("allows when the user holds a required role (admin)", () => {
    const guard = new RolesGuard(reflectorReturning(["admin"]));
    expect(guard.canActivate(ctx({ role: "admin" }))).toBe(true);
  });

  it("denies (403) when the user's role is not required (streamer vs admin-only)", () => {
    const guard = new RolesGuard(reflectorReturning(["admin"]));
    expect(() => guard.canActivate(ctx({ role: "streamer" }))).toThrow(ForbiddenException);
  });

  it("denies (403) when no user is attached to the request", () => {
    const guard = new RolesGuard(reflectorReturning(["admin"]));
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it("denies (403) when the user carries no role", () => {
    const guard = new RolesGuard(reflectorReturning(["admin"]));
    expect(() => guard.canActivate(ctx({}))).toThrow(ForbiddenException);
  });

  it("reads role off the request via a real Reflector + real @Roles metadata (end to end)", () => {
    class AdminOnly {
      mutate(): void {}
    }
    Roles("admin")(
      AdminOnly.prototype,
      "mutate",
      Object.getOwnPropertyDescriptor(AdminOnly.prototype, "mutate")!,
    );
    const guard = new RolesGuard(new Reflector());
    const context = {
      getHandler: () => AdminOnly.prototype.mutate,
      getClass: () => AdminOnly,
      switchToHttp: () => ({ getRequest: () => ({ user: { role: "streamer" } }) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
