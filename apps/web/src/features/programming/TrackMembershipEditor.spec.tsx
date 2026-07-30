import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", () => ({
  programmingApi: {
    getPlaylist: vi.fn(),
    setPlaylistTracks: vi.fn(),
    listMedia: vi.fn(),
  },
}));

import { programmingApi } from "./api";
import type { PlaylistDetailDto, PlaylistDto, TrackDto } from "./types";
import { TrackMembershipEditor } from "./TrackMembershipEditor";

const mockApi = vi.mocked(programmingApi);

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const playlist: PlaylistDto = {
  id: "p1",
  name: "Currents",
  order: "shuffle",
  dedupWindowMin: 60,
  isJingle: false,
  trackCount: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const detail: PlaylistDetailDto = {
  ...playlist,
  tracks: [
    { trackId: "t1", position: 0, title: "Alpha", artist: "A", fileName: "a.mp3", durationSec: 180 },
    { trackId: "t2", position: 1, title: "Bravo", artist: "B", fileName: "b.mp3", durationSec: 200 },
  ],
};

const library: TrackDto[] = [
  { id: "t1", fileName: "a.mp3", title: "Alpha", artist: "A", album: null, durationSec: 180, cueIn: 0, cueOut: null, fadeIn: 0, fadeOut: 0, amplifyDb: 0, createdAt: "x", updatedAt: "x" },
  { id: "t2", fileName: "b.mp3", title: "Bravo", artist: "B", album: null, durationSec: 200, cueIn: 0, cueOut: null, fadeIn: 0, fadeOut: 0, amplifyDb: 0, createdAt: "x", updatedAt: "x" },
  { id: "t3", fileName: "c.mp3", title: "Charlie", artist: "C", album: null, durationSec: 210, cueIn: 0, cueOut: null, fadeIn: 0, fadeOut: 0, amplifyDb: 0, createdAt: "x", updatedAt: "x" },
];

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup({ pointerEventsCheck: 0 }),
    ...render(
      <QueryClientProvider client={qc}>
        <TrackMembershipEditor playlist={playlist} open onOpenChange={() => {}} />
      </QueryClientProvider>,
    ),
  };
}

describe("TrackMembershipEditor", () => {
  it("saves the reordered, added and pruned membership as one ordered PUT", async () => {
    mockApi.getPlaylist.mockResolvedValue(detail);
    mockApi.setPlaylistTracks.mockResolvedValue(detail);
    mockApi.listMedia.mockResolvedValue(library);
    const { user } = renderEditor();

    // Wait for the current membership to load.
    await screen.findByText("Alpha");

    // Move Bravo above Alpha → [t2, t1].
    await user.click(screen.getByRole("button", { name: /move bravo up/i }));

    // Add Charlie from the library → [t2, t1, t3].
    await user.click(screen.getByRole("button", { name: /add charlie/i }));

    // Remove Alpha → [t2, t3].
    await user.click(screen.getByRole("button", { name: /remove alpha/i }));

    await user.click(screen.getByRole("button", { name: /save tracks/i }));

    await waitFor(() =>
      expect(mockApi.setPlaylistTracks).toHaveBeenCalledWith("p1", ["t2", "t3"]),
    );
  });

  it("only offers library tracks not already in the playlist", async () => {
    mockApi.getPlaylist.mockResolvedValue(detail);
    mockApi.listMedia.mockResolvedValue(library);
    renderEditor();

    // Charlie is addable; Alpha/Bravo are already members (no Add button for them).
    expect(await screen.findByRole("button", { name: /add charlie/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add alpha/i })).not.toBeInTheDocument();
  });
});
