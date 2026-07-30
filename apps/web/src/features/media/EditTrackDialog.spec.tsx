import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TrackDto } from "./api";

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock("./hooks", () => ({
  useUpdateTrack: () => ({ mutateAsync, isPending: false, error: null }),
}));

import { EditTrackDialog } from "./EditTrackDialog";

const track: TrackDto = {
  id: "t1",
  fileName: "song-abc123.mp3",
  title: "Song",
  artist: "Artist",
  album: "Album",
  durationSec: 200,
  cueIn: 2,
  cueOut: null,
  fadeIn: 1,
  fadeOut: 3,
  amplifyDb: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function open(t: TrackDto = track) {
  render(<EditTrackDialog track={t} />);
  await userEvent.click(screen.getByRole("button", { name: /edit/i }));
}

beforeEach(() => vi.clearAllMocks());

describe("EditTrackDialog", () => {
  it("prefills the form from the track metadata", async () => {
    await open();
    expect(screen.getByLabelText(/title/i)).toHaveValue("Song");
    expect(screen.getByLabelText(/artist/i)).toHaveValue("Artist");
    expect(screen.getByLabelText(/album/i)).toHaveValue("Album");
    expect(screen.getByLabelText(/cue in/i)).toHaveValue(2);
    expect(screen.getByLabelText(/fade out/i)).toHaveValue(3);
  });

  it("submits the edited metadata as a PATCH payload, clearing artist to null", async () => {
    mutateAsync.mockResolvedValue(track);
    await open();

    const title = screen.getByLabelText(/title/i);
    await userEvent.clear(title);
    await userEvent.type(title, "Renamed");
    await userEvent.clear(screen.getByLabelText(/artist/i)); // clearing sends explicit null

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "t1",
      input: {
        title: "Renamed",
        artist: null,
        album: "Album",
        cueIn: 2,
        cueOut: null,
        fadeIn: 1,
        fadeOut: 3,
        amplifyDb: 0,
      },
    });
  });

  it("blocks an empty title with a surfaced validation error and does not submit", async () => {
    await open();
    await userEvent.clear(screen.getByLabelText(/title/i));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
