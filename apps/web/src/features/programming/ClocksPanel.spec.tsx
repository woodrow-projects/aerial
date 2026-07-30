import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", () => ({
  programmingApi: {
    listClocks: vi.fn(),
    getClock: vi.fn(),
    createClock: vi.fn(),
    updateClock: vi.fn(),
    deleteClock: vi.fn(),
    listPlaylists: vi.fn(),
  },
}));

import { programmingApi } from "./api";
import type { ClockDto } from "./types";
import { ClocksPanel } from "./ClocksPanel";

const mockApi = vi.mocked(programmingApi);

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.listPlaylists.mockResolvedValue([]);
});

const clocks: ClockDto[] = [
  {
    id: "c1",
    name: "Daytime Music",
    slotCount: 8,
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
        <ClocksPanel />
      </QueryClientProvider>,
    ),
  };
}

describe("ClocksPanel", () => {
  it("lists each clock with its slot count", async () => {
    mockApi.listClocks.mockResolvedValue(clocks);
    renderPanel();
    const row = within(await screen.findByRole("row", { name: /daytime music/i }));
    expect(row.getByText("8")).toBeInTheDocument();
  });

  it("surfaces the 409 that names the referrers blocking a delete", async () => {
    mockApi.listClocks.mockResolvedValue(clocks);
    mockApi.deleteClock.mockRejectedValue(
      new Error("cannot delete clock: it is referenced by channel default-clock: Main"),
    );
    const { user } = renderPanel();

    const row = within(await screen.findByRole("row", { name: /daytime music/i }));
    await user.click(row.getByRole("button", { name: /delete/i }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /delete/i }));

    expect(
      await screen.findByText(/referenced by channel default-clock: Main/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockApi.deleteClock).toHaveBeenCalledWith("c1"));
  });
});
