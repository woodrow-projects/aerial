import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChannelDto } from "@aerial/shared";

vi.mock("./api", () => ({
  autoDjApi: {
    listClocks: vi.fn(),
    setDefaultClock: vi.fn(),
    setEnforceSchedule: vi.fn(),
    getPlaylog: vi.fn(),
  },
}));

import { autoDjApi } from "./api";
import { AutoDjControls } from "./AutoDjControls";

const mockApi = vi.mocked(autoDjApi);

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const base = {
  id: "c1",
  name: "Main",
  slug: "main",
} as unknown as ChannelDto;

function makeChannel(over: Partial<ChannelDto> = {}): ChannelDto {
  return { ...base, defaultClockId: "k1", enforceSchedule: true, ...over };
}

function renderControls(channel: ChannelDto = makeChannel()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup({ pointerEventsCheck: 0 }),
    ...render(
      <QueryClientProvider client={qc}>
        <AutoDjControls channel={channel} />
      </QueryClientProvider>,
    ),
  };
}

async function pickClock(user: ReturnType<typeof userEvent.setup>, option: RegExp) {
  await user.click(screen.getByRole("combobox", { name: /default clock/i }));
  await user.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.listClocks.mockResolvedValue([
    { id: "k1", name: "Morning Clock" },
    { id: "k2", name: "Overnight Clock" },
  ]);
  mockApi.setDefaultClock.mockResolvedValue(makeChannel());
  mockApi.setEnforceSchedule.mockResolvedValue(makeChannel());
});

describe("AutoDjControls — enforce toggle (ADR D18)", () => {
  it("reflects the channel's enforceSchedule as the switch state", async () => {
    renderControls(makeChannel({ enforceSchedule: true }));
    expect(screen.getByRole("switch", { name: /enforce schedule/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("defaults to enforced when the field is absent (DB default is true)", () => {
    renderControls(makeChannel({ enforceSchedule: undefined }));
    expect(screen.getByRole("switch", { name: /enforce schedule/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("PATCHes the negated value when toggled off", async () => {
    const { user } = renderControls(makeChannel({ enforceSchedule: true }));
    await user.click(screen.getByRole("switch", { name: /enforce schedule/i }));
    await waitFor(() => expect(mockApi.setEnforceSchedule).toHaveBeenCalledWith("c1", false));
  });
});

describe("AutoDjControls — default clock picker (ADR D17)", () => {
  it("PATCHes the chosen clock id", async () => {
    const { user } = renderControls(makeChannel({ defaultClockId: "k1" }));
    await pickClock(user, /overnight clock/i);
    await waitFor(() => expect(mockApi.setDefaultClock).toHaveBeenCalledWith("c1", "k2"));
  });

  it("clears the clock to null via the 'None' option", async () => {
    const { user } = renderControls(makeChannel({ defaultClockId: "k1" }));
    await pickClock(user, /none/i);
    await waitFor(() => expect(mockApi.setDefaultClock).toHaveBeenCalledWith("c1", null));
  });
});

describe("AutoDjControls — errors & playout log", () => {
  it("surfaces an admin-only (403) mutation error", async () => {
    mockApi.setEnforceSchedule.mockRejectedValue(new Error("Forbidden"));
    const { user } = renderControls();
    await user.click(screen.getByRole("switch", { name: /enforce schedule/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/forbidden/i);
  });

  it("opens the playout log disclosure", async () => {
    mockApi.getPlaylog.mockResolvedValue([]);
    const { user } = renderControls();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /playout log/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
