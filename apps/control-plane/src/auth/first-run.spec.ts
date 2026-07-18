import { describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";
import { ADMIN_ROLE, firstRunCreateGate } from "./first-run";

/**
 * The first-run gate makes operator sign-up self-locking: the very first
 * account (empty user table) becomes the admin; once any user exists, sign-up
 * is closed — no AUTH_DISABLE_SIGNUP flip, no redeploy, no open window.
 */
describe("firstRunCreateGate (self-locking first-run sign-up)", () => {
  it("makes the first user an admin when the user table is empty", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const result = await firstRunCreateGate({ email: "ada@example.com", name: "Ada" }, count);
    expect(result).toEqual({ data: { email: "ada@example.com", name: "Ada", role: ADMIN_ROLE } });
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("preserves the original user fields and only adds the role", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const result = await firstRunCreateGate({ id: "u_1", email: "a@b.c", emailVerified: false }, count);
    expect(result.data).toMatchObject({ id: "u_1", email: "a@b.c", emailVerified: false, role: ADMIN_ROLE });
  });

  it("rejects sign-up once any user exists (signup is self-locked)", async () => {
    const count = vi.fn().mockResolvedValue(1);
    await expect(firstRunCreateGate({ email: "x@y.z" }, count)).rejects.toBeInstanceOf(APIError);
  });

  it("rejects with a 403 FORBIDDEN and a clear message", async () => {
    const count = vi.fn().mockResolvedValue(3);
    const err = await firstRunCreateGate({ email: "x@y.z" }, count).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).status).toBe("FORBIDDEN");
    expect((err as APIError).statusCode).toBe(403);
    expect((err as APIError).body?.message).toMatch(/closed/i);
  });
});
