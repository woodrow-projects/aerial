import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TrackDto } from "./api";

const { deleteFn } = vi.hoisted(() => ({ deleteFn: vi.fn() }));
vi.mock("./hooks", () => ({
  useDeleteTrack: () => ({ mutate: deleteFn, mutateAsync: deleteFn, isPending: false, error: null }),
  useUpdateTrack: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

import { TrackTable } from "./TrackTable";

const track: TrackDto = {
  id: "t1",
  fileName: "song-abc123.mp3",
  title: "Song",
  artist: "Artist",
  album: "Album",
  durationSec: 200, // 3:20
  cueIn: 0,
  cueOut: null,
  fadeIn: 0,
  fadeOut: 0,
  amplifyDb: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => vi.clearAllMocks());

describe("TrackTable", () => {
  it("renders title, artist, album, formatted duration, and the storage file name", () => {
    render(<TrackTable tracks={[track]} />);
    expect(screen.getByText("Song")).toBeInTheDocument();
    // scope to data cells so the assertions don't match the column headers
    expect(screen.getByRole("cell", { name: "Artist" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Album" })).toBeInTheDocument();
    expect(screen.getByText("3:20")).toBeInTheDocument(); // mm:ss
    expect(screen.getByText("song-abc123.mp3")).toBeInTheDocument();
  });

  it("deletes a track only after confirmation, warning it leaves playlists", async () => {
    render(<TrackTable tracks={[track]} />);

    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    // the confirm dialog explains the playlist side-effect before anything happens
    expect(screen.getByText(/playlist/i)).toBeInTheDocument();
    expect(deleteFn).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /delete track/i }));
    await waitFor(() => expect(deleteFn).toHaveBeenCalledWith("t1"));
  });
});
