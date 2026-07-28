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

import { api } from "@/api";
import {
  channelsKey,
  channelsQueryOptions,
  useChannels,
  useCreateChannel,
  useSetActive,
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
