import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", () => ({
  scheduleApi: {
    listShows: vi.fn(),
    getSchedule: vi.fn(),
    createShow: vi.fn(),
    updateShow: vi.fn(),
    deleteShow: vi.fn(),
    listChannels: vi.fn(),
    listClocks: vi.fn(),
    listUsers: vi.fn(),
  },
}));

import { scheduleApi } from "./api";
import {
  showsKey,
  scheduleKey,
  channelsKey,
  clocksKey,
  usersKey,
  useShows,
  useScheduleNowNext,
  useChannels,
  useClocks,
  useUsers,
  useCreateShow,
  useUpdateShow,
  useDeleteShow,
} from "./hooks";
import type { CreateShowBody } from "./types";

const mockApi = vi.mocked(scheduleApi);

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("schedule queries", () => {
  it("useShows fetches per channel and is disabled without one", async () => {
    mockApi.listShows.mockResolvedValue([{ id: "s1" }] as never);

    const disabled = renderHook(() => useShows(undefined), { wrapper: wrapper(makeClient()) });
    expect(disabled.result.current.fetchStatus).toBe("idle");
    expect(mockApi.listShows).not.toHaveBeenCalled();

    const { result } = renderHook(() => useShows("c1"), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.listShows).toHaveBeenCalledWith("c1");
    expect(result.current.data).toEqual([{ id: "s1" }]);
  });

  it("useScheduleNowNext reads the now/next endpoint for the channel", async () => {
    mockApi.getSchedule.mockResolvedValue({ at: "x", now: { kind: "default" }, next: null } as never);
    const { result } = renderHook(() => useScheduleNowNext("c1"), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.getSchedule).toHaveBeenCalledWith("c1");
  });

  it("useChannels / useClocks / useUsers read their list endpoints", async () => {
    mockApi.listChannels.mockResolvedValue([{ id: "c1" }] as never);
    mockApi.listClocks.mockResolvedValue([{ id: "k1" }] as never);
    mockApi.listUsers.mockResolvedValue([{ id: "u1" }] as never);

    const channels = renderHook(() => useChannels(), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(channels.result.current.isSuccess).toBe(true));
    expect(channels.result.current.data).toEqual([{ id: "c1" }]);

    const clocks = renderHook(() => useClocks(), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(clocks.result.current.isSuccess).toBe(true));

    const users = renderHook(() => useUsers(), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(users.result.current.isSuccess).toBe(true));
  });

  it("useClocks / useUsers honour an `enabled` gate", () => {
    renderHook(() => useClocks(false), { wrapper: wrapper(makeClient()) });
    renderHook(() => useUsers(false), { wrapper: wrapper(makeClient()) });
    expect(mockApi.listClocks).not.toHaveBeenCalled();
    expect(mockApi.listUsers).not.toHaveBeenCalled();
  });
});

describe("schedule mutations", () => {
  it("useCreateShow posts the discriminated body and invalidates shows + schedule", async () => {
    mockApi.createShow.mockResolvedValue({ id: "s1" } as never);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateShow("c1"), { wrapper: wrapper(qc) });

    const body: CreateShowBody = {
      type: "scheduled",
      title: "Morning",
      startTime: "06:00",
      endTime: "10:00",
      daysOfWeek: [1, 2, 3, 4, 5],
      priority: 0,
      clockId: "k1",
    };
    await result.current.mutateAsync(body);

    expect(mockApi.createShow).toHaveBeenCalledWith("c1", body);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: showsKey("c1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: scheduleKey("c1") });
  });

  it("useUpdateShow patches the given show and invalidates shows + schedule", async () => {
    mockApi.updateShow.mockResolvedValue({ id: "s1" } as never);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateShow("c1"), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ showId: "s1", body: { title: "Renamed" } });

    expect(mockApi.updateShow).toHaveBeenCalledWith("c1", "s1", { title: "Renamed" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: showsKey("c1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: scheduleKey("c1") });
  });

  it("useDeleteShow deletes the given show and invalidates shows + schedule", async () => {
    mockApi.deleteShow.mockResolvedValue(undefined);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteShow("c1"), { wrapper: wrapper(qc) });

    await result.current.mutateAsync("s1");

    expect(mockApi.deleteShow).toHaveBeenCalledWith("c1", "s1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: showsKey("c1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: scheduleKey("c1") });
  });
});

describe("query keys", () => {
  it("namespace channel-scoped resources under the channel", () => {
    expect(channelsKey).toEqual(["channels"]);
    expect(showsKey("c1")).toEqual(["channels", "c1", "shows"]);
    expect(scheduleKey("c1")).toEqual(["channels", "c1", "schedule"]);
    expect(clocksKey).toEqual(["clocks"]);
    expect(usersKey).toEqual(["users"]);
  });
});
