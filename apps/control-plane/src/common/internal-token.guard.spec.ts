import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedException } from "@nestjs/common";

// env is evaluated once at import; mock it as a mutable object so each test can
// set the configured token without re-importing the module.
vi.mock("../config/env", () => ({ env: { internal: { token: "" } } }));
import { env } from "../config/env";
import { InternalTokenGuard } from "./internal-token.guard";

function context(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as never;
}

describe("InternalTokenGuard (ADR D10 — internal hooks)", () => {
  const guard = new InternalTokenGuard();

  beforeEach(() => {
    env.internal.token = "";
  });

  it("fails closed: rejects every request when no token is configured", () => {
    env.internal.token = "";
    expect(() => guard.canActivate(context({ "x-internal-token": "anything" }))).toThrow(UnauthorizedException);
  });

  it("rejects a request whose token does not match", () => {
    env.internal.token = "expected-secret";
    expect(() => guard.canActivate(context({ "x-internal-token": "wrong-secret" }))).toThrow(UnauthorizedException);
  });

  it("rejects a request with a missing token header", () => {
    env.internal.token = "expected-secret";
    expect(() => guard.canActivate(context({}))).toThrow(UnauthorizedException);
  });

  it("rejects a token that is a prefix of the expected value (length-checked)", () => {
    env.internal.token = "expected-secret";
    expect(() => guard.canActivate(context({ "x-internal-token": "expected" }))).toThrow(UnauthorizedException);
  });

  it("allows a request whose token matches exactly", () => {
    env.internal.token = "expected-secret";
    expect(guard.canActivate(context({ "x-internal-token": "expected-secret" }))).toBe(true);
  });
});
