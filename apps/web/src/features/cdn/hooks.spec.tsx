import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CdnConfigDto } from "@aerial/shared";

vi.mock("@/api", () => ({
  api: {
    getCdn: vi.fn(),
    setCdnKey: vi.fn(),
    enableCdn: vi.fn(),
    disableCdn: vi.fn(),
  },
}));

import { api } from "@/api";
import {
  cdnKey,
  cdnRefetchInterval,
  cdnBecameProvisioned,
  useEnableCdn,
} from "./hooks";

const mockApi = vi.mocked(api);

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const cdn = (status: CdnConfigDto["status"]): CdnConfigDto =>
  ({ status }) as unknown as CdnConfigDto;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cdnRefetchInterval", () => {
  it("polls every 3s while provisioning, and not otherwise", () => {
    expect(cdnRefetchInterval(cdn("provisioning"))).toBe(3000);
    expect(cdnRefetchInterval(cdn("active"))).toBe(false);
    expect(cdnRefetchInterval(cdn("disabled"))).toBe(false);
    expect(cdnRefetchInterval(cdn("error"))).toBe(false);
    expect(cdnRefetchInterval(undefined)).toBe(false);
  });
});

describe("cdnBecameProvisioned", () => {
  it("fires exactly on the provisioning -> settled transition", () => {
    expect(cdnBecameProvisioned("provisioning", "active")).toBe(true);
    expect(cdnBecameProvisioned("provisioning", "error")).toBe(true);
    expect(cdnBecameProvisioned("provisioning", "provisioning")).toBe(false);
    expect(cdnBecameProvisioned("active", "active")).toBe(false);
    expect(cdnBecameProvisioned(undefined, "provisioning")).toBe(false);
  });
});

describe("useEnableCdn", () => {
  it("enables via the api client and invalidates the cdn query", async () => {
    mockApi.enableCdn.mockResolvedValue(cdn("provisioning"));
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useEnableCdn(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync();

    expect(mockApi.enableCdn).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: cdnKey });
  });
});
