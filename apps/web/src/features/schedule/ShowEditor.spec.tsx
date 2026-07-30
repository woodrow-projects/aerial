import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", () => ({
  scheduleApi: {
    createShow: vi.fn(),
    updateShow: vi.fn(),
    deleteShow: vi.fn(),
    listClocks: vi.fn(),
    listUsers: vi.fn(),
  },
}));

import { scheduleApi } from "./api";
import type { ClockSummary, ShowDto, UserSummary } from "./types";
import { ShowEditor } from "./ShowEditor";

const mockApi = vi.mocked(scheduleApi);

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const clocks: ClockSummary[] = [
  { id: "k1", name: "Morning Clock" },
  { id: "k2", name: "Overnight Clock" },
];
const users: UserSummary[] = [
  { id: "u1", name: "Ada Lovelace", role: "streamer" },
  { id: "u2", name: "Grace Hopper", role: "admin" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.listClocks.mockResolvedValue(clocks);
  mockApi.listUsers.mockResolvedValue(users);
});

const scheduledShow: ShowDto = {
  id: "s1",
  channelId: "c1",
  type: "scheduled",
  title: "Daytime",
  clockId: "k1",
  ownerId: null,
  startTime: "10:00",
  endTime: "14:00",
  daysOfWeek: [1, 2, 3, 4, 5],
  dateStart: null,
  dateEnd: null,
  priority: 0,
  createdAt: "x",
  updatedAt: "x",
};

function renderEditor(props: { show?: ShowDto; onOpenChange?: (o: boolean) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = props.onOpenChange ?? vi.fn();
  return {
    onOpenChange,
    user: userEvent.setup({ pointerEventsCheck: 0 }),
    ...render(
      <QueryClientProvider client={qc}>
        <ShowEditor channelId="c1" show={props.show} open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    ),
  };
}

async function pick(user: ReturnType<typeof userEvent.setup>, combobox: RegExp, option: string) {
  await user.click(screen.getByRole("combobox", { name: combobox }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("ShowEditor (create)", () => {
  it("posts a scheduled show with its clock and default full-week recurrence", async () => {
    mockApi.createShow.mockResolvedValue(scheduledShow);
    const { user, onOpenChange } = renderEditor();

    await user.type(screen.getByLabelText(/title/i), "Morning Drive");
    await pick(user, /clock/i, "Morning Clock");

    await user.click(screen.getByRole("button", { name: /create show/i }));

    await waitFor(() =>
      expect(mockApi.createShow).toHaveBeenCalledWith("c1", {
        type: "scheduled",
        title: "Morning Drive",
        startTime: "06:00",
        endTime: "10:00",
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        priority: 0,
        clockId: "k1",
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("posts a live show owned by the chosen user (no clock)", async () => {
    mockApi.createShow.mockResolvedValue({ ...scheduledShow, type: "live" });
    const { user } = renderEditor();

    await user.type(screen.getByLabelText(/title/i), "Ada Live");
    await user.click(screen.getByRole("button", { name: "Live" }));
    await pick(user, /owner/i, "Ada Lovelace");

    await user.click(screen.getByRole("button", { name: /create show/i }));

    await waitFor(() =>
      expect(mockApi.createShow).toHaveBeenCalledWith("c1", {
        type: "live",
        title: "Ada Live",
        startTime: "06:00",
        endTime: "10:00",
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        priority: 0,
        ownerId: "u1",
      }),
    );
  });

  it("carries the day-of-week toggles into the payload", async () => {
    mockApi.createShow.mockResolvedValue(scheduledShow);
    const { user } = renderEditor();

    await user.type(screen.getByLabelText(/title/i), "Weekdays");
    // Drop Sunday and Saturday from the default full week.
    await user.click(screen.getByRole("button", { name: "Sun" }));
    await user.click(screen.getByRole("button", { name: "Sat" }));
    await pick(user, /clock/i, "Morning Clock");

    await user.click(screen.getByRole("button", { name: /create show/i }));

    await waitFor(() =>
      expect(mockApi.createShow).toHaveBeenCalledWith(
        "c1",
        expect.objectContaining({ daysOfWeek: [1, 2, 3, 4, 5] }),
      ),
    );
  });

  it("blocks submit and surfaces a message when the title is empty", async () => {
    const { user } = renderEditor();

    await pick(user, /clock/i, "Morning Clock");
    await user.click(screen.getByRole("button", { name: /create show/i }));

    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockApi.createShow).not.toHaveBeenCalled();
  });

  it("blocks submit when no day is selected", async () => {
    const { user } = renderEditor();

    await user.type(screen.getByLabelText(/title/i), "No Days");
    for (const d of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      await user.click(screen.getByRole("button", { name: d }));
    }
    await pick(user, /clock/i, "Morning Clock");
    await user.click(screen.getByRole("button", { name: /create show/i }));

    expect(await screen.findByText(/at least one day/i)).toBeInTheDocument();
    expect(mockApi.createShow).not.toHaveBeenCalled();
  });

  it("surfaces a server error verbatim and keeps the editor open", async () => {
    mockApi.createShow.mockRejectedValue(new Error("unknown clock id: k9"));
    const { user, onOpenChange } = renderEditor();

    await user.type(screen.getByLabelText(/title/i), "Bad Clock");
    await pick(user, /clock/i, "Morning Clock");
    await user.click(screen.getByRole("button", { name: /create show/i }));

    expect(await screen.findByText(/unknown clock id: k9/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("ShowEditor (edit)", () => {
  it("prefills the show and PATCHes the applied changes", async () => {
    mockApi.updateShow.mockResolvedValue(scheduledShow);
    const { user } = renderEditor({ show: scheduledShow });

    const title = screen.getByLabelText(/title/i);
    expect(title).toHaveValue("Daytime");

    await user.clear(title);
    await user.type(title, "Afternoon");
    await user.click(screen.getByRole("button", { name: /save show/i }));

    await waitFor(() =>
      expect(mockApi.updateShow).toHaveBeenCalledWith(
        "c1",
        "s1",
        expect.objectContaining({
          title: "Afternoon",
          startTime: "10:00",
          endTime: "14:00",
          daysOfWeek: [1, 2, 3, 4, 5],
          clockId: "k1",
        }),
      ),
    );
  });

  it("does not offer a type toggle when editing (type is immutable)", () => {
    renderEditor({ show: scheduledShow });
    expect(screen.queryByRole("button", { name: "Live" })).not.toBeInTheDocument();
  });

  it("deletes the show after confirmation and closes", async () => {
    mockApi.deleteShow.mockResolvedValue(undefined);
    const { user, onOpenChange } = renderEditor({ show: scheduledShow });

    await user.click(screen.getByRole("button", { name: /delete show/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(mockApi.deleteShow).toHaveBeenCalledWith("c1", "s1"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
