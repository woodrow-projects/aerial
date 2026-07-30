import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChannelDto, CreateChannelInput } from "@aerial/shared";

vi.mock("@/api", () => ({
  api: {
    listChannels: vi.fn(),
    createChannel: vi.fn(),
    setActive: vi.fn(),
    setDeliveryMode: vi.fn(),
    deleteChannel: vi.fn(),
    listKeys: vi.fn(),
    createKey: vi.fn(),
    revokeKey: vi.fn(),
  },
}));

vi.mock("./api", () => ({
  autoDjApi: {
    listClocks: vi.fn(),
    setDefaultClock: vi.fn(),
    setEnforceSchedule: vi.fn(),
    getPlaylog: vi.fn(),
  },
}));

import { api } from "@/api";
import { autoDjApi } from "./api";
import {
  channelsKey,
  channelsQueryOptions,
  playlogKey,
  playlogQueryOptions,
  useChannels,
  useClocks,
  useCreateChannel,
  usePlaylog,
  useSetActive,
  useSetDefaultClock,
  useSetEnforceSchedule,
} from "./hooks";

const mockApi = vi.mocked(api);
const mockAutoDj = vi.mocked(autoDjApi);

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const sampleChannel = { id: "c1", name: "Main", slug: "main" } as unknown as ChannelDto;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("channelsQueryOptions", () => {
  it("polls channels every 5s through the api client (the old setInterval)", () => {
    const opts = channelsQueryOptions();
    expect(opts.queryKey).toEqual(channelsKey);
    expect(opts.queryFn).toBe(mockApi.listChannels);
    expect(opts.refetchInterval).toBe(5000);
  });
});

describe("useChannels", () => {
  it("maps the listChannels response into query data", async () => {
    mockApi.listChannels.mockResolvedValue([sampleChannel]);
    const { result } = renderHook(() => useChannels(), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([sampleChannel]);
    expect(mockApi.listChannels).toHaveBeenCalledTimes(1);
  });
});

describe("useCreateChannel", () => {
  it("creates via the api client and invalidates the channels query", async () => {
    mockApi.createChannel.mockResolvedValue(sampleChannel);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateChannel(), { wrapper: wrapper(qc) });

    const input: CreateChannelInput = { name: "Main", slug: "main", deliveryMode: "both" };
    await result.current.mutateAsync(input);

    expect(mockApi.createChannel).toHaveBeenCalledWith(input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: channelsKey });
  });
});

describe("useSetActive", () => {
  it("starts/stops a channel and invalidates the channels query", async () => {
    mockApi.setActive.mockResolvedValue(sampleChannel);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSetActive(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ id: "c1", isActive: false });

    expect(mockApi.setActive).toHaveBeenCalledWith("c1", false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: channelsKey });
  });
});

// ── Auto-DJ additions (Phase E) ─────────────────────────────────────────────────

describe("useClocks", () => {
  it("maps the listClocks response for the default-clock picker", async () => {
    mockAutoDj.listClocks.mockResolvedValue([{ id: "k1", name: "Morning" }]);
    const { result } = renderHook(() => useClocks(), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "k1", name: "Morning" }]);
  });
});

describe("useSetDefaultClock", () => {
  it("PATCHes the chosen clock and invalidates the channels query", async () => {
    mockAutoDj.setDefaultClock.mockResolvedValue(sampleChannel);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSetDefaultClock(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ id: "c1", defaultClockId: "k1" });

    expect(mockAutoDj.setDefaultClock).toHaveBeenCalledWith("c1", "k1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: channelsKey });
  });

  it("clears the default clock by PATCHing null", async () => {
    mockAutoDj.setDefaultClock.mockResolvedValue(sampleChannel);
    const { result } = renderHook(() => useSetDefaultClock(), { wrapper: wrapper(makeClient()) });

    await result.current.mutateAsync({ id: "c1", defaultClockId: null });

    expect(mockAutoDj.setDefaultClock).toHaveBeenCalledWith("c1", null);
  });
});

describe("useSetEnforceSchedule", () => {
  it("PATCHes enforceSchedule and invalidates the channels query", async () => {
    mockAutoDj.setEnforceSchedule.mockResolvedValue(sampleChannel);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSetEnforceSchedule(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ id: "c1", enforceSchedule: false });

    expect(mockAutoDj.setEnforceSchedule).toHaveBeenCalledWith("c1", false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: channelsKey });
  });
});

describe("playlogQueryOptions", () => {
  it("reads the channel playlog with polling OFF (manual refresh only)", () => {
    const opts = playlogQueryOptions("c1", { enabled: true });
    expect(opts.queryKey).toEqual(playlogKey("c1"));
    expect(opts.enabled).toBe(true);
    expect(opts.refetchInterval).toBe(false);
  });
});

describe("usePlaylog", () => {
  it("fetches the newest decisions when enabled", async () => {
    mockAutoDj.getPlaylog.mockResolvedValue([{ id: "pl1" }] as never);
    const { result } = renderHook(() => usePlaylog("c1", { enabled: true }), {
      wrapper: wrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockAutoDj.getPlaylog).toHaveBeenCalledWith("c1", undefined);
    expect(result.current.data).toEqual([{ id: "pl1" }]);
  });

  it("does not fetch while the log is closed (disabled)", () => {
    renderHook(() => usePlaylog("c1", { enabled: false }), { wrapper: wrapper(makeClient()) });
    expect(mockAutoDj.getPlaylog).not.toHaveBeenCalled();
  });
});
