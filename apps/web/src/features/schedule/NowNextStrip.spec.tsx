import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", () => ({
  scheduleApi: { getSchedule: vi.fn() },
}));

import { scheduleApi } from "./api";
import type { ScheduleNowNext } from "./types";
import { NowNextStrip } from "./NowNextStrip";

const mockApi = vi.mocked(scheduleApi);

beforeEach(() => {
  vi.clearAllMocks();
});

function renderStrip(props: { clocksById?: Record<string, string>; usersById?: Record<string, string> } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NowNextStrip channelId="c1" clocksById={props.clocksById} usersById={props.usersById} />
    </QueryClientProvider>,
  );
}

describe("NowNextStrip", () => {
  it("shows the on-air scheduled show with its clock, and no upcoming change", async () => {
    const data: ScheduleNowNext = {
      at: "2026-07-20T09:00:00.000Z",
      now: { kind: "scheduled", showId: "s1", showTitle: "Morning Drive", clockId: "k1", ownerId: null },
      next: null,
    };
    mockApi.getSchedule.mockResolvedValue(data);
    renderStrip({ clocksById: { k1: "Morning Clock" } });

    const now = within(await screen.findByTestId("now-panel"));
    expect(await now.findByText("Morning Drive")).toBeInTheDocument();
    expect(now.getByText("Morning Clock")).toBeInTheDocument();

    expect(await screen.findByText(/nothing scheduled/i)).toBeInTheDocument();
  });

  it("labels Auto-DJ fill on now and the next show's start boundary", async () => {
    const data: ScheduleNowNext = {
      at: "2026-07-20T12:00:00.000Z",
      now: { kind: "default", showId: null, showTitle: null, clockId: "kd", ownerId: null },
      next: {
        at: "2026-07-20T18:00:00.000Z",
        boundary: "start",
        showId: "s2",
        showTitle: "Evening Session",
        resolution: { kind: "scheduled", showId: "s2", showTitle: "Evening Session", clockId: "k2", ownerId: null },
      },
    };
    mockApi.getSchedule.mockResolvedValue(data);
    renderStrip();

    const now = within(await screen.findByTestId("now-panel"));
    expect(await now.findByText(/auto-dj/i)).toBeInTheDocument();

    const next = within(await screen.findByTestId("next-panel"));
    expect(await next.findByText("Evening Session")).toBeInTheDocument();
    expect(next.getByText(/starts/i)).toBeInTheDocument();
  });

  it("shows the live show's owner when a streamer's show is on air", async () => {
    const data: ScheduleNowNext = {
      at: "2026-07-20T20:00:00.000Z",
      now: { kind: "live", showId: "s3", showTitle: "Ada Live", clockId: null, ownerId: "u1" },
      next: null,
    };
    mockApi.getSchedule.mockResolvedValue(data);
    renderStrip({ usersById: { u1: "Ada Lovelace" } });

    const now = within(await screen.findByTestId("now-panel"));
    expect(await now.findByText("Ada Live")).toBeInTheDocument();
    expect(now.getByText("Ada Lovelace")).toBeInTheDocument();
  });
});
