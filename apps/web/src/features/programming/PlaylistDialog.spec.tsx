import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", () => ({
  programmingApi: {
    createPlaylist: vi.fn(),
    updatePlaylist: vi.fn(),
  },
}));

import { programmingApi } from "./api";
import type { PlaylistDto } from "./types";
import { PlaylistDialog } from "./PlaylistDialog";

const mockApi = vi.mocked(programmingApi);

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function renderDialog(playlist?: PlaylistDto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup({ pointerEventsCheck: 0 }),
    ...render(
      <QueryClientProvider client={qc}>
        <PlaylistDialog open onOpenChange={() => {}} playlist={playlist} />
      </QueryClientProvider>,
    ),
  };
}

const existing: PlaylistDto = {
  id: "p1",
  name: "Currents",
  order: "shuffle",
  dedupWindowMin: 60,
  isJingle: false,
  trackCount: 12,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("PlaylistDialog (create)", () => {
  it("posts name, chosen order, dedup window and the jingle flag", async () => {
    mockApi.createPlaylist.mockResolvedValue({ ...existing, id: "new" });
    const { user } = renderDialog();

    await user.type(screen.getByLabelText(/name/i), "Jingles");

    await user.click(screen.getByRole("combobox", { name: /order/i }));
    await user.click(await screen.findByRole("option", { name: /sequential/i }));

    const dedup = screen.getByLabelText(/dedup/i);
    await user.clear(dedup);
    await user.type(dedup, "0");

    await user.click(screen.getByLabelText(/jingle/i));

    await user.click(screen.getByRole("button", { name: /create playlist/i }));

    await waitFor(() =>
      expect(mockApi.createPlaylist).toHaveBeenCalledWith({
        name: "Jingles",
        order: "sequential",
        dedupWindowMin: 0,
        isJingle: true,
      }),
    );
  });
});

describe("PlaylistDialog (edit)", () => {
  it("prefills from the playlist and patches the changed name", async () => {
    mockApi.updatePlaylist.mockResolvedValue(existing);
    const { user } = renderDialog(existing);

    const name = screen.getByLabelText(/name/i);
    expect(name).toHaveValue("Currents");

    await user.clear(name);
    await user.type(name, "Gold");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(mockApi.updatePlaylist).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ name: "Gold" }),
      ),
    );
  });
});
