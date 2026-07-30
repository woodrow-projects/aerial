import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChannelDto, StreamKeyCreatedDto, StreamKeyDto } from "@aerial/shared";

vi.mock("@/api", () => ({
  api: {
    listKeys: vi.fn(),
    createKey: vi.fn(),
    revokeKey: vi.fn(),
    setActive: vi.fn(),
    setDeliveryMode: vi.fn(),
    deleteChannel: vi.fn(),
  },
}));

// ChannelCard now embeds AutoDjControls, whose hooks read the local Auto-DJ api;
// stub it so this card renders without real fetches (clocks resolve to empty).
vi.mock("./api", () => ({
  autoDjApi: {
    listClocks: vi.fn(),
    setDefaultClock: vi.fn(),
    setEnforceSchedule: vi.fn(),
    getPlaylog: vi.fn(),
  },
}));

import { api } from "@/api";
import { autoDjApi } from "./api";
import { ChannelCard } from "./ChannelCard";

const mockApi = vi.mocked(api);
const mockAutoDj = vi.mocked(autoDjApi);

const channel: ChannelDto = {
  id: "c1",
  name: "Main",
  slug: "main",
  isActive: true,
  deliveryMode: "both",
  hlsBitrates: [64, 128],
  icecastBitrate: 128,
  mount: "/main",
  harborPort: 9000,
  endpoints: {
    hls: "https://radio.example.com/hls/main/live.m3u8",
    icecast: "https://radio.example.com/icecast/main",
    nowPlaying: "https://radio.example.com/hls/main/nowplaying.json",
    ingest: {
      host: "radio.example.com",
      port: 8000,
      mount: "/main",
      username: "source",
      protocol: "icecast",
      tls: true,
    },
  },
  live: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChannelCard channel={channel} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.listKeys.mockResolvedValue([]);
  mockAutoDj.listClocks.mockResolvedValue([]);
});

describe("ChannelCard stream keys", () => {
  it("reveals a freshly created key exactly once, with a shown-once notice", async () => {
    const created: StreamKeyCreatedDto = {
      id: "k-new",
      channelId: "c1",
      key: "sk_live_SUPERSECRET",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    mockApi.createKey.mockResolvedValue(created);

    renderCard();

    // Nothing secret is on screen before creation.
    expect(screen.queryByText("sk_live_SUPERSECRET")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /new key/i }));

    // The plaintext key and the "shown once" warning appear after creation.
    expect(await screen.findByText("sk_live_SUPERSECRET")).toBeInTheDocument();
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    expect(mockApi.createKey).toHaveBeenCalledWith("c1");
  });

  it("revokes an active key through the api client", async () => {
    const existing: StreamKeyDto = {
      id: "k-existing",
      channelId: "c1",
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: null,
    };
    mockApi.listKeys.mockResolvedValue([existing]);
    mockApi.revokeKey.mockResolvedValue(undefined as unknown as Response);

    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: /revoke/i }));

    await waitFor(() => expect(mockApi.revokeKey).toHaveBeenCalledWith("c1", "k-existing"));
  });
});

describe("ChannelCard Auto-DJ wiring", () => {
  it("embeds the default-clock picker, the enforce toggle, and the playout log", () => {
    renderCard();
    expect(screen.getByRole("combobox", { name: /default clock/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /enforce schedule/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /playout log/i })).toBeInTheDocument();
  });
});
