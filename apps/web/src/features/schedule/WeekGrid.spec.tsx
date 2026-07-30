import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ShowDto } from "./types";
import { WeekGrid } from "./WeekGrid";

const show = (over: Partial<ShowDto>): ShowDto => ({
  id: "s1",
  channelId: "c1",
  type: "scheduled",
  title: "Show",
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
  ...over,
});

describe("WeekGrid", () => {
  it("renders one positioned block per aired day of a same-day show", () => {
    render(
      <WeekGrid shows={[show({ title: "Daytime", daysOfWeek: [1, 3] })]} onSelectShow={vi.fn()} />,
    );
    const blocks = screen.getAllByTestId("show-block");
    expect(blocks).toHaveLength(2);
    // Each block is absolutely positioned via inline top/height.
    expect(blocks[0].style.top).not.toBe("");
    expect(blocks[0].style.height).not.toBe("");
  });

  it("splits an overnight show into two blocks and flags the wrapped tail", () => {
    render(
      <WeekGrid
        shows={[show({ title: "Late Night", daysOfWeek: [5], startTime: "22:00", endTime: "02:00" })]}
        onSelectShow={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Late Night")).toHaveLength(2);
    expect(screen.getByText(/cont\./i)).toBeInTheDocument();
  });

  it("labels a scheduled block with its clock and a live block with its owner", () => {
    render(
      <WeekGrid
        shows={[
          show({ id: "a", title: "Auto Hour", type: "scheduled", clockId: "k1", daysOfWeek: [2] }),
          show({
            id: "b",
            title: "Ada Live",
            type: "live",
            clockId: null,
            ownerId: "u1",
            daysOfWeek: [4],
          }),
        ]}
        clocksById={{ k1: "Morning Clock" }}
        usersById={{ u1: "Ada Lovelace" }}
        onSelectShow={vi.fn()}
      />,
    );
    expect(screen.getByText("Morning Clock")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("invokes onSelectShow with the show when its block is clicked", async () => {
    const user = userEvent.setup();
    const onSelectShow = vi.fn();
    const s = show({ id: "click-me", title: "Clickable", daysOfWeek: [1] });
    render(<WeekGrid shows={[s]} onSelectShow={onSelectShow} />);

    await user.click(screen.getByTestId("show-block"));
    expect(onSelectShow).toHaveBeenCalledWith(s);
  });

  it("shows an Auto-DJ hint when the week has no shows", () => {
    render(<WeekGrid shows={[]} onSelectShow={vi.fn()} />);
    expect(screen.getByText(/auto-dj/i)).toBeInTheDocument();
    expect(screen.queryByTestId("show-block")).not.toBeInTheDocument();
  });
});
