import { UnauthorizedException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// better-auth is ESM + does real session work; mock the session API and the
// header adapter so the guard can be unit-tested without a request context.
const getSession = vi.fn();
vi.mock("./auth", () => ({ auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } } }));
vi.mock("better-auth/node", () => ({ fromNodeHeaders: (h: unknown) => h }));

import { AuthGuard } from "./auth.guard";

function reflectorReturning(isPublic: boolean | undefined): Reflector {
  return { getAllAndOverride: vi.fn(() => isPublic) } as unknown as Reflector;
}

function ctx(req: Record<string, unknown> = { headers: {} }) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

describe("AuthGuard", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("allows @Public() routes without checking a session", async () => {
    const guard = new AuthGuard(reflectorReturning(true));
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("rejects a protected route with no valid session", async () => {
    getSession.mockResolvedValue(null);
    const guard = new AuthGuard(reflectorReturning(false));
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("allows a protected route with a valid session and attaches user/session to the request", async () => {
    const session = { user: { id: "op_1" }, session: { id: "sess_1" } };
    getSession.mockResolvedValue(session);
    const req: Record<string, unknown> = { headers: { cookie: "session=abc" } };
    const guard = new AuthGuard(reflectorReturning(false));

    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.user).toEqual(session.user);
    expect(req.session).toEqual(session.session);
  });
});
