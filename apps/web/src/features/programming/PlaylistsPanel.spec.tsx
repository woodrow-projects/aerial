import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", () => ({
  programmingApi: {
    listPlaylists: vi.fn(),
    getPlaylist: vi.fn(),
    createPlaylist: vi.fn(),
    updatePlaylist: vi.fn(),
    setPlaylistTracks: vi.fn(),
    deletePlaylist: vi.fn(),
    listMedia: vi.fn(),
  },
}));

import { programmingApi } from "./api";
import type { PlaylistDto } from "./types";
import { PlaylistsPanel } from "./PlaylistsPanel";

const mockApi = vi.mocked(programmingApi);

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.listMedia.mockResolvedValue([]);
});

const playlists: PlaylistDto[] = [
  {
    id: "p1",
    name: "Currents",
    order: "shuffle",
    dedupWindowMin: 60,
    isJingle: false,
    trackCount: 12,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "p2",
    name: "Station IDs",
    order: "sequential",
    dedupWindowMin: 0,
    isJingle: true,
    trackCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup({ pointerEventsCheck: 0 }),
    ...render(
      <QueryClientProvider client={qc}>
        <PlaylistsPanel />
      </QueryClientProvider>,
    ),
  };
}

describe("PlaylistsPanel", () => {
  it("lists each playlist with its order, track count and a jingle badge", async () => {
    mockApi.listPlaylists.mockResolvedValue(playlists);
    renderPanel();

    const currents = within(await screen.findByRole("row", { name: /currents/i }));
    expect(currents.getByText("shuffle")).toBeInTheDocument();
    expect(currents.getByText("12")).toBeInTheDocument();

    const ids = within(screen.getByRole("row", { name: /station ids/i }));
    expect(ids.getByText(/jingle/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no playlists", async () => {
    mockApi.listPlaylists.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText(/no playlists/i)).toBeInTheDocument();
  });

  it("surfaces the 409 that names the clocks blocking a delete", async () => {
    mockApi.listPlaylists.mockResolvedValue(playlists);
    mockApi.deletePlaylist.mockRejectedValue(
      new Error("cannot delete playlist: it is used by clock(s): Daytime"),
    );
    const { user } = renderPanel();

    const currents = within(await screen.findByRole("row", { name: /currents/i }));
    await user.click(currents.getByRole("button", { name: /delete/i }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /delete/i }));

    expect(
      await screen.findByText(/cannot delete playlist: it is used by clock\(s\): Daytime/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockApi.deletePlaylist).toHaveBeenCalledWith("p1"));
  });
});
