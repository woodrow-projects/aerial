import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CreateClockInput, CreatePlaylistInput } from "@aerial/shared";

vi.mock("./api", () => ({
  programmingApi: {
    listPlaylists: vi.fn(),
    getPlaylist: vi.fn(),
    createPlaylist: vi.fn(),
    updatePlaylist: vi.fn(),
    setPlaylistTracks: vi.fn(),
    deletePlaylist: vi.fn(),
    listClocks: vi.fn(),
    getClock: vi.fn(),
    createClock: vi.fn(),
    updateClock: vi.fn(),
    deleteClock: vi.fn(),
    listMedia: vi.fn(),
  },
}));

import { programmingApi } from "./api";
import {
  playlistsKey,
  playlistKey,
  clocksKey,
  clockKey,
  mediaKey,
  usePlaylists,
  useMedia,
  useClocks,
  useCreatePlaylist,
  useUpdatePlaylist,
  useSetPlaylistTracks,
  useDeletePlaylist,
  useCreateClock,
  useUpdateClock,
  useDeleteClock,
} from "./hooks";

const mockApi = vi.mocked(programmingApi);

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

describe("programming queries", () => {
  it("usePlaylists maps the listPlaylists response", async () => {
    mockApi.listPlaylists.mockResolvedValue([{ id: "p1" }] as never);
    const { result } = renderHook(() => usePlaylists(), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "p1" }]);
  });

  it("useMedia maps the listMedia response", async () => {
    mockApi.listMedia.mockResolvedValue([{ id: "t1" }] as never);
    const { result } = renderHook(() => useMedia(), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "t1" }]);
  });

  it("useClocks maps the listClocks response", async () => {
    mockApi.listClocks.mockResolvedValue([{ id: "c1" }] as never);
    const { result } = renderHook(() => useClocks(), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "c1" }]);
  });
});

describe("playlist mutations", () => {
  it("useCreatePlaylist posts and invalidates the playlists list", async () => {
    mockApi.createPlaylist.mockResolvedValue({ id: "p1" } as never);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreatePlaylist(), { wrapper: wrapper(qc) });

    const input: CreatePlaylistInput = {
      name: "Currents",
      order: "shuffle",
      dedupWindowMin: 60,
      isJingle: false,
    };
    await result.current.mutateAsync(input);

    expect(mockApi.createPlaylist).toHaveBeenCalledWith(input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: playlistsKey });
  });

  it("useUpdatePlaylist patches and invalidates both the list and that playlist", async () => {
    mockApi.updatePlaylist.mockResolvedValue({ id: "p1" } as never);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdatePlaylist(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ id: "p1", input: { name: "Gold" } });

    expect(mockApi.updatePlaylist).toHaveBeenCalledWith("p1", { name: "Gold" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: playlistsKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: playlistKey("p1") });
  });

  it("useSetPlaylistTracks PUTs the ordered ids and invalidates list + playlist", async () => {
    mockApi.setPlaylistTracks.mockResolvedValue({ id: "p1" } as never);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSetPlaylistTracks("p1"), { wrapper: wrapper(qc) });

    await result.current.mutateAsync(["t2", "t1"]);

    expect(mockApi.setPlaylistTracks).toHaveBeenCalledWith("p1", ["t2", "t1"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: playlistsKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: playlistKey("p1") });
  });

  it("useDeletePlaylist deletes and invalidates the playlists list", async () => {
    mockApi.deletePlaylist.mockResolvedValue(undefined);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeletePlaylist(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync("p1");

    expect(mockApi.deletePlaylist).toHaveBeenCalledWith("p1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: playlistsKey });
  });
});

describe("clock mutations", () => {
  it("useCreateClock posts and invalidates the clocks list", async () => {
    mockApi.createClock.mockResolvedValue({ id: "c1" } as never);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateClock(), { wrapper: wrapper(qc) });

    const input: CreateClockInput = { name: "Daytime", slots: [{ position: 0, playlistId: "p1", count: 1 }] };
    await result.current.mutateAsync(input);

    expect(mockApi.createClock).toHaveBeenCalledWith(input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: clocksKey });
  });

  it("useUpdateClock patches and invalidates the list and that clock", async () => {
    mockApi.updateClock.mockResolvedValue({ id: "c1" } as never);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateClock(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ id: "c1", input: { name: "Overnight" } });

    expect(mockApi.updateClock).toHaveBeenCalledWith("c1", { name: "Overnight" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: clocksKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: clockKey("c1") });
  });

  it("useDeleteClock deletes and invalidates the clocks list", async () => {
    mockApi.deleteClock.mockResolvedValue(undefined);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteClock(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync("c1");

    expect(mockApi.deleteClock).toHaveBeenCalledWith("c1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: clocksKey });
  });
});

describe("query keys", () => {
  it("namespace list and detail resources distinctly", () => {
    expect(playlistsKey).toEqual(["playlists"]);
    expect(playlistKey("p1")).toEqual(["playlists", "p1"]);
    expect(clocksKey).toEqual(["clocks"]);
    expect(clockKey("c1")).toEqual(["clocks", "c1"]);
    expect(mediaKey).toEqual(["media"]);
  });
});
