import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CdnService } from "./cdn.service";
import type { CdnProviderAdapter, ProvisionResult } from "./provider";

/** Minimal in-memory stand-in for prisma.cdnConfig (the singleton row). */
function fakePrisma() {
  let row: Record<string, unknown> | null = null;
  const defaults = () => ({
    id: 1,
    provider: "bunny",
    status: "disabled",
    pullZoneId: null,
    cdnHostname: null,
    apiKeyEnc: null,
    errorMessage: null,
    createdAt: new Date("2026-06-18T00:00:00Z"),
    updatedAt: new Date("2026-06-18T00:00:00Z"),
  });
  const cdnConfig = {
    upsert: vi.fn(async ({ create, update }: { create: object; update: object }) => {
      row = row ? { ...row, ...update } : { ...defaults(), ...create };
      return { ...row };
    }),
    update: vi.fn(async ({ data }: { data: object }) => {
      row = { ...(row ?? defaults()), ...data, updatedAt: new Date() };
      return { ...row };
    }),
  };
  return { cdnConfig, peek: () => row } as const;
}

function fakeProvider(overrides: Partial<CdnProviderAdapter> = {}): CdnProviderAdapter {
  return {
    id: "bunny",
    provision: vi.fn(
      async (): Promise<ProvisionResult> => ({ pullZoneId: "zone-1", cdnHostname: "aerial-test.b-cdn.net" }),
    ),
    configure: vi.fn(async () => undefined),
    teardown: vi.fn(async () => undefined),
    ...overrides,
  };
}

const ORIGIN = "https://radio.example.com";

describe("CdnService state machine", () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let provider: CdnProviderAdapter;
  let svc: CdnService;

  beforeEach(() => {
    prisma = fakePrisma();
    provider = fakeProvider();
    svc = new CdnService(prisma as never, provider);
  });

  it("defaults to origin HLS base when disabled", async () => {
    await svc.onModuleInit();
    expect(svc.hlsBaseUrl()).toBe(ORIGIN);
  });

  it("refuses to enable without an API key", async () => {
    await expect(svc.enable()).rejects.toBeInstanceOf(BadRequestException);
  });

  it("provisions disabled → active and flips the HLS base to the CDN", async () => {
    await svc.setKey("bunny-key");
    await svc.runProvisioning();

    expect(provider.provision).toHaveBeenCalledOnce();
    expect(provider.configure).toHaveBeenCalledOnce();
    const status = await svc.getStatus();
    expect(status.status).toBe("active");
    expect(status.cdnHostname).toBe("aerial-test.b-cdn.net");
    expect(status.hasApiKey).toBe(true);
    expect(svc.hlsBaseUrl()).toBe("https://aerial-test.b-cdn.net");
  });

  it("is idempotent: a retry after a persisted pullZoneId does NOT create a duplicate zone", async () => {
    await svc.setKey("bunny-key");
    // First attempt: zone created, but configure() fails → status error, pullZoneId kept.
    const failing = fakeProvider({
      configure: vi.fn(async () => {
        throw new Error("transient configure failure");
      }),
    });
    const svc1 = new CdnService(prisma as never, failing);
    await expect(svc1.runProvisioning()).rejects.toThrow("transient");
    expect(failing.provision).toHaveBeenCalledOnce();
    expect(prisma.peek()?.pullZoneId).toBe("zone-1");
    expect(prisma.peek()?.status).toBe("error");

    // Retry with a healthy provider: must reuse the zone (no second provision()).
    await svc.runProvisioning();
    expect(provider.provision).not.toHaveBeenCalled();
    expect(provider.configure).toHaveBeenCalledOnce();
    expect((await svc.getStatus()).status).toBe("active");
  });

  it("records an error message and keeps HLS on the origin when provisioning fails", async () => {
    await svc.setKey("bunny-key");
    const failing = new CdnService(
      prisma as never,
      fakeProvider({
        provision: vi.fn(async () => {
          throw new Error("bad API key");
        }),
      }),
    );
    await expect(failing.runProvisioning()).rejects.toThrow("bad API key");
    const status = await failing.getStatus();
    expect(status.status).toBe("error");
    expect(status.errorMessage).toContain("bad API key");
    expect(failing.hlsBaseUrl()).toBe(ORIGIN);
  });

  it("disable reverts HLS to the origin but keeps the pull zone", async () => {
    await svc.setKey("bunny-key");
    await svc.runProvisioning();
    expect(svc.hlsBaseUrl()).toBe("https://aerial-test.b-cdn.net");

    const status = await svc.disable();
    expect(status.status).toBe("disabled");
    expect(svc.hlsBaseUrl()).toBe(ORIGIN);
    expect(prisma.peek()?.pullZoneId).toBe("zone-1"); // zone intact so embeds keep working
  });
});
