import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", () => ({
  scheduleApi: {
    listShows: vi.fn(),
    getSchedule: vi.fn(),
    createShow: vi.fn(),
    updateShow: vi.fn(),
    deleteShow: vi.fn(),
    listChannels: vi.fn(),
    listClocks: vi.fn(),
    listUsers: vi.fn(),
  },
}));

import { scheduleApi } from "./api";
import type { ChannelSummary, ShowDto } from "./types";
import { ScheduleScreen } from "./ScheduleScreen";

const mockApi = vi.mocked(scheduleApi);

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const channels: ChannelSummary[] = [
  { id: "c1", name: "Main", slug: "main" },
  { id: "c2", name: "Jazz", slug: "jazz" },
];

const showOn = (channelId: string, title: string): ShowDto => ({
  id: `${channelId}-show`,
  channelId,
  type: "scheduled",
  title,
  clockId: "k1",
  ownerId: null,
  startTime: "10:00",
  endTime: "12:00",
  daysOfWeek: [1],
  dateStart: null,
  dateEnd: null,
  priority: 0,
  createdAt: "x",
  updatedAt: "x",
});

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getSchedule.mockResolvedValue({ at: "x", now: { kind: "default", showId: null, showTitle: null, clockId: null, ownerId: null }, next: null });
  mockApi.listClocks.mockResolvedValue([]);
  mockApi.listUsers.mockResolvedValue([]);
});

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup({ pointerEventsCheck: 0 }),
    ...render(
      <QueryClientProvider client={qc}>
        <ScheduleScreen />
      </QueryClientProvider>,
    ),
  };
}

describe("ScheduleScreen", () => {
  it("loads the first channel's shows by default", async () => {
    mockApi.listChannels.mockResolvedValue(channels);
    mockApi.listShows.mockImplementation(async (id: string) =>
      id === "c1" ? [showOn("c1", "Morning Drive")] : [],
    );
    renderScreen();

    expect(await screen.findByText("Morning Drive")).toBeInTheDocument();
    expect(mockApi.listShows).toHaveBeenCalledWith("c1");
  });

  it("loads the newly selected channel's shows when the channel changes", async () => {
    mockApi.listChannels.mockResolvedValue(channels);
    mockApi.listShows.mockImplementation(async (id: string) =>
      id === "c2" ? [showOn("c2", "Late Jazz")] : [showOn("c1", "Morning Drive")],
    );
    const { user } = renderScreen();

    await screen.findByText("Morning Drive");

    await user.click(screen.getByRole("combobox", { name: /channel/i }));
    await user.click(await screen.findByRole("option", { name: "Jazz" }));

    expect(await screen.findByText("Late Jazz")).toBeInTheDocument();
    expect(mockApi.listShows).toHaveBeenCalledWith("c2");
  });

  it("opens the create editor from the Add show button", async () => {
    mockApi.listChannels.mockResolvedValue(channels);
    mockApi.listShows.mockResolvedValue([]);
    const { user } = renderScreen();

    await user.click(await screen.findByRole("button", { name: /add show/i }));

    expect(await screen.findByText(/new show/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create show/i })).toBeInTheDocument();
  });

  it("opens the editor prefilled when a show block is clicked", async () => {
    mockApi.listChannels.mockResolvedValue(channels);
    mockApi.listShows.mockImplementation(async (id: string) =>
      id === "c1" ? [showOn("c1", "Morning Drive")] : [],
    );
    const { user } = renderScreen();

    await user.click(await screen.findByTestId("show-block"));

    expect(await screen.findByText(/edit show/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveValue("Morning Drive");
    expect(screen.getByRole("button", { name: /save show/i })).toBeInTheDocument();
  });

  it("prompts to create a channel when none exist", async () => {
    mockApi.listChannels.mockResolvedValue([]);
    renderScreen();

    expect(await screen.findByText(/create a channel/i)).toBeInTheDocument();
    expect(screen.queryByTestId("show-block")).not.toBeInTheDocument();
  });
});
