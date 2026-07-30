import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
    listClocks: vi.fn(),
    getClock: vi.fn(),
    createClock: vi.fn(),
    updateClock: vi.fn(),
    deleteClock: vi.fn(),
    listMedia: vi.fn(),
  },
}));

import { programmingApi } from "./api";
import { ProgrammingScreen } from "./ProgrammingScreen";

const mockApi = vi.mocked(programmingApi);

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.listPlaylists.mockResolvedValue([]);
  mockApi.listClocks.mockResolvedValue([]);
  mockApi.listMedia.mockResolvedValue([]);
});

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup({ pointerEventsCheck: 0 }),
    ...render(
      <QueryClientProvider client={qc}>
        <ProgrammingScreen />
      </QueryClientProvider>,
    ),
  };
}

describe("ProgrammingScreen", () => {
  it("shows the Playlists section first", async () => {
    renderScreen();
    expect(await screen.findByRole("button", { name: /new playlist/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new clock/i })).not.toBeInTheDocument();
  });

  it("switches to the Clocks section when its tab is chosen", async () => {
    const { user } = renderScreen();
    await user.click(screen.getByRole("tab", { name: /clocks/i }));
    expect(await screen.findByRole("button", { name: /new clock/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new playlist/i })).not.toBeInTheDocument();
  });
});
