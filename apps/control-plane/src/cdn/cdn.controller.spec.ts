import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CdnController } from "./cdn.controller";
import { RolesGuard } from "../auth/roles";
import type { CdnService } from "./cdn.service";

/**
 * Baseline tests for the CDN controller. It is a thin delegation layer over
 * CdnService, so these assert each route forwards to the right service method
 * with the right argument. HTTP-layer concerns (@HttpCode, the ZodValidationPipe
 * binding, the global AuthGuard) are exercised by e2e, not here.
 */
function mockCdnService() {
  return {
    getStatus: vi.fn(async () => ({ status: "disabled" })),
    setKey: vi.fn(async () => ({ status: "disabled", hasApiKey: true })),
    enable: vi.fn(async () => ({ status: "provisioning" })),
    disable: vi.fn(async () => ({ status: "disabled" })),
  };
}

describe("CdnController", () => {
  let service: ReturnType<typeof mockCdnService>;
  let controller: CdnController;

  beforeEach(() => {
    service = mockCdnService();
    controller = new CdnController(service as unknown as CdnService);
  });

  it("GET /api/cdn → CdnService.getStatus()", async () => {
    const out = await controller.status();
    expect(service.getStatus).toHaveBeenCalledOnce();
    expect(out).toEqual({ status: "disabled" });
  });

  it("PUT /api/cdn/key → CdnService.setKey(body.apiKey)", async () => {
    await controller.setKey({ apiKey: "bunny-key" });
    expect(service.setKey).toHaveBeenCalledWith("bunny-key");
  });

  it("POST /api/cdn/enable → CdnService.enable()", async () => {
    const out = await controller.enable();
    expect(service.enable).toHaveBeenCalledOnce();
    expect(out).toEqual({ status: "provisioning" });
  });

  it("POST /api/cdn/disable → CdnService.disable()", async () => {
    await controller.disable();
    expect(service.disable).toHaveBeenCalledOnce();
  });
});

/**
 * RBAC (ADR D18): CDN controls change install-wide delivery (and touch the CDN API
 * key), so every mutation is admin-only; a streamer's panel is read-only. Proven by
 * running the real RolesGuard against the real @Roles metadata on each route. The
 * status read stays open to any authenticated session.
 */
describe("CdnController RBAC", () => {
  const guard = new RolesGuard(new Reflector());
  const ctxFor = (handler: (...a: never[]) => unknown, role: string): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => CdnController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    }) as unknown as ExecutionContext;

  const mutations = {
    setKey: CdnController.prototype.setKey,
    enable: CdnController.prototype.enable,
    disable: CdnController.prototype.disable,
  };

  for (const [name, handler] of Object.entries(mutations)) {
    it(`denies a streamer (403) and allows an admin on ${name}`, () => {
      expect(() => guard.canActivate(ctxFor(handler, "streamer"))).toThrow(ForbiddenException);
      expect(guard.canActivate(ctxFor(handler, "admin"))).toBe(true);
    });
  }

  it("leaves the status read open to any session (not admin-gated)", () => {
    expect(guard.canActivate(ctxFor(CdnController.prototype.status, "streamer"))).toBe(true);
  });
});
