import { beforeEach, describe, expect, it, vi } from "vitest";
import { CdnController } from "./cdn.controller";
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
