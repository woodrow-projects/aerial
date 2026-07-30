import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", () => ({
  programmingApi: {
    listPlaylists: vi.fn(),
    getClock: vi.fn(),
    createClock: vi.fn(),
    updateClock: vi.fn(),
  },
}));

import { programmingApi } from "./api";
import type { ClockDetailDto, ClockDto, PlaylistDto } from "./types";
import { ClockwheelEditor } from "./ClockwheelEditor";

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

const pl = (id: string, name: string): PlaylistDto => ({
  id,
  name,
  order: "shuffle",
  dedupWindowMin: 60,
  isJingle: false,
  trackCount: 5,
  createdAt: "x",
  updatedAt: "x",
});

const playlists = [pl("p1", "Currents"), pl("p2", "Jingles")];

function renderEditor(clock?: ClockDto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup({ pointerEventsCheck: 0 }),
    ...render(
      <QueryClientProvider client={qc}>
        <ClockwheelEditor clock={clock} open onOpenChange={() => {}} />
      </QueryClientProvider>,
    ),
  };
}

async function addSlot(user: ReturnType<typeof userEvent.setup>) {
  const add = screen.getByRole("button", { name: /add slot/i });
  await waitFor(() => expect(add).toBeEnabled());
  await user.click(add);
}

async function chooseSlotPlaylist(
  user: ReturnType<typeof userEvent.setup>,
  slot: number,
  label: string,
) {
  await user.click(screen.getByRole("combobox", { name: new RegExp(`slot ${slot} playlist`, "i") }));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("ClockwheelEditor (new)", () => {
  it("saves the slot sequence atomically with contiguous, index-based positions", async () => {
    mockApi.listPlaylists.mockResolvedValue(playlists);
    mockApi.createClock.mockResolvedValue({} as ClockDetailDto);
    const { user } = renderEditor();

    await user.type(screen.getByLabelText(/name/i), "Daytime");
    await addSlot(user);
    await addSlot(user);

    // Second slot draws from Jingles; first slot gets 3 tracks of airtime.
    await chooseSlotPlaylist(user, 2, "Jingles");
    await user.click(screen.getByRole("button", { name: /slot 1 increase/i }));
    await user.click(screen.getByRole("button", { name: /slot 1 increase/i }));

    await user.click(screen.getByRole("button", { name: /create clock/i }));

    await waitFor(() =>
      expect(mockApi.createClock).toHaveBeenCalledWith({
        name: "Daytime",
        slots: [
          { position: 0, playlistId: "p1", count: 3 },
          { position: 1, playlistId: "p2", count: 1 },
        ],
      }),
    );
  });

  it("renumbers positions from 0 after a reorder", async () => {
    mockApi.listPlaylists.mockResolvedValue(playlists);
    mockApi.createClock.mockResolvedValue({} as ClockDetailDto);
    const { user } = renderEditor();

    await user.type(screen.getByLabelText(/name/i), "Rotation");
    await addSlot(user);
    await addSlot(user);
    await chooseSlotPlaylist(user, 2, "Jingles");

    // Pull the Jingles slot to the top → it becomes position 0.
    await user.click(screen.getByRole("button", { name: /move slot 2 up/i }));

    await user.click(screen.getByRole("button", { name: /create clock/i }));

    await waitFor(() =>
      expect(mockApi.createClock).toHaveBeenCalledWith({
        name: "Rotation",
        slots: [
          { position: 0, playlistId: "p2", count: 1 },
          { position: 1, playlistId: "p1", count: 1 },
        ],
      }),
    );
  });

  it("keeps a slot's count at a floor of 1 and renders the wheel", async () => {
    mockApi.listPlaylists.mockResolvedValue(playlists);
    const { user } = renderEditor();

    await addSlot(user);
    await user.click(screen.getByRole("button", { name: /slot 1 decrease/i }));
    expect(screen.getByLabelText(/slot 1 count/i)).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: /slot 1 increase/i }));
    expect(screen.getByLabelText(/slot 1 count/i)).toHaveTextContent("2");

    expect(screen.getByRole("img", { name: /clockwheel/i })).toBeInTheDocument();
  });

  it("blocks saving until the clock has a name and at least one slot", async () => {
    mockApi.listPlaylists.mockResolvedValue(playlists);
    const { user } = renderEditor();

    expect(screen.getByRole("button", { name: /create clock/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/name/i), "Empty");
    // Name but no slots — still blocked.
    expect(screen.getByRole("button", { name: /create clock/i })).toBeDisabled();

    await addSlot(user);
    expect(screen.getByRole("button", { name: /create clock/i })).toBeEnabled();
  });
});

describe("ClockwheelEditor (edit)", () => {
  it("loads existing slots and PATCHes the full sequence with the edit applied", async () => {
    const clock: ClockDto = {
      id: "c1",
      name: "Daytime",
      slotCount: 1,
      createdAt: "x",
      updatedAt: "x",
    };
    const detail: ClockDetailDto = {
      ...clock,
      slots: [{ position: 0, playlistId: "p1", playlistName: "Currents", count: 2 }],
    };
    mockApi.listPlaylists.mockResolvedValue(playlists);
    mockApi.getClock.mockResolvedValue(detail);
    mockApi.updateClock.mockResolvedValue(detail);
    const { user } = renderEditor(clock);

    // Existing slot loads with its count.
    await waitFor(() => expect(screen.getByLabelText(/slot 1 count/i)).toHaveTextContent("2"));

    await user.click(screen.getByRole("button", { name: /slot 1 increase/i }));
    await user.click(screen.getByRole("button", { name: /save clock/i }));

    await waitFor(() =>
      expect(mockApi.updateClock).toHaveBeenCalledWith("c1", {
        name: "Daytime",
        slots: [{ position: 0, playlistId: "p1", count: 3 }],
      }),
    );
  });
});
