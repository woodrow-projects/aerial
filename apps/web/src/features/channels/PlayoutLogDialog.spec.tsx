import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", () => ({
  autoDjApi: {
    listClocks: vi.fn(),
    setDefaultClock: vi.fn(),
    setEnforceSchedule: vi.fn(),
    getPlaylog: vi.fn(),
  },
}));

import { autoDjApi, type PlayLogEntry } from "./api";
import { PlayoutLogDialog } from "./PlayoutLogDialog";

const mockApi = vi.mocked(autoDjApi);

const entry: PlayLogEntry = {
  id: "pl1",
  at: "2026-07-20T10:00:00.000Z",
  channelId: "c1",
  trackId: "t1",
  playlistId: "p1",
  clockId: "k1",
  slotPosition: 0,
  showId: null,
  reason: 'unscheduled -> default clock "Morning" slot 0 -> playlist "Bed" (shuffle, dedup 60m)',
  uri: 'annotate:title="Sunrise",artist="Aurora":/srv/media/sunrise.mp3',
};

function renderDialog(open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup({ pointerEventsCheck: 0 }),
    ...render(
      <QueryClientProvider client={qc}>
        <PlayoutLogDialog channelId="c1" channelName="Main" open={open} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlayoutLogDialog", () => {
  it("reads the channel's newest decisions on open and shows title + reason", async () => {
    mockApi.getPlaylog.mockResolvedValue([entry]);
    renderDialog();

    // Title is parsed from the annotate URI (the DTO carries no title field).
    expect(await screen.findByText("Sunrise")).toBeInTheDocument();
    expect(screen.getByText(/unscheduled -> default clock "Morning"/)).toBeInTheDocument();
    expect(mockApi.getPlaylog).toHaveBeenCalledWith("c1", undefined);
  });

  it("does not read while closed", () => {
    mockApi.getPlaylog.mockResolvedValue([entry]);
    renderDialog(false);
    expect(mockApi.getPlaylog).not.toHaveBeenCalled();
  });

  it("re-reads on manual Refresh (no polling — refresh is the only re-fetch)", async () => {
    mockApi.getPlaylog.mockResolvedValue([entry]);
    const { user } = renderDialog();

    await screen.findByText("Sunrise");
    expect(mockApi.getPlaylog).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(mockApi.getPlaylog).toHaveBeenCalledTimes(2));
  });

  it("shows an empty state when there are no decisions yet", async () => {
    mockApi.getPlaylog.mockResolvedValue([]);
    renderDialog();
    expect(await screen.findByText(/no playout decisions yet/i)).toBeInTheDocument();
  });

  it("surfaces a read error", async () => {
    mockApi.getPlaylog.mockRejectedValue(new Error("boom"));
    renderDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent(/boom/i);
  });
});
