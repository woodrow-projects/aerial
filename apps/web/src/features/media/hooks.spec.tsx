import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CreateTrackMetaInput } from "@aerial/shared";

vi.mock("./api", () => ({
  listTracks: vi.fn(),
  uploadTrack: vi.fn(),
  updateTrack: vi.fn(),
  deleteTrack: vi.fn(),
}));

import * as mediaApi from "./api";
import type { TrackDto } from "./api";
import { mediaKey, useTracks, useUploadTrack, useUpdateTrack, useDeleteTrack } from "./hooks";

const api = vi.mocked(mediaApi);

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const track = { id: "t1", title: "Song", durationSec: 120 } as unknown as TrackDto;

beforeEach(() => vi.clearAllMocks());

describe("useTracks", () => {
  it("loads the media library through the api client", async () => {
    api.listTracks.mockResolvedValue([track]);
    const { result } = renderHook(() => useTracks(), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([track]);
    expect(api.listTracks).toHaveBeenCalledTimes(1);
  });
});

describe("useUploadTrack", () => {
  it("uploads a file and invalidates the media query", async () => {
    api.uploadTrack.mockResolvedValue(track);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUploadTrack(), { wrapper: wrapper(qc) });

    const file = new File(["x"], "song.mp3", { type: "audio/mpeg" });
    await result.current.mutateAsync(file);

    expect(api.uploadTrack).toHaveBeenCalledWith(file);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: mediaKey });
  });
});

describe("useUpdateTrack", () => {
  it("patches metadata by id and invalidates the media query", async () => {
    api.updateTrack.mockResolvedValue(track);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateTrack(), { wrapper: wrapper(qc) });

    const input: CreateTrackMetaInput = { title: "New", artist: null };
    await result.current.mutateAsync({ id: "t1", input });

    expect(api.updateTrack).toHaveBeenCalledWith("t1", input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: mediaKey });
  });
});

describe("useDeleteTrack", () => {
  it("deletes by id and invalidates the media query", async () => {
    api.deleteTrack.mockResolvedValue(undefined);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteTrack(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync("t1");

    expect(api.deleteTrack).toHaveBeenCalledWith("t1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: mediaKey });
  });
});
