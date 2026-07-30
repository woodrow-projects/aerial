import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", () => ({
  usersApi: {
    list: vi.fn(),
    setRole: vi.fn(),
    createStreamerKey: vi.fn(),
    revokeStreamerKey: vi.fn(),
  },
}));

import { usersApi } from "./api";
import type { UserSummary } from "./api";
import { UserRow } from "./UserRow";

const mockApi = vi.mocked(usersApi);

// Radix Select relies on a handful of DOM APIs jsdom doesn't implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const admin: UserSummary = {
  id: "u1",
  name: "Ada",
  email: "ada@example.com",
  role: "admin",
  hasStreamerKey: false,
};
const streamer: UserSummary = {
  id: "u2",
  name: "Grace",
  email: "grace@example.com",
  role: "streamer",
  hasStreamerKey: true,
};

function renderRow(user: UserSummary) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup({ pointerEventsCheck: 0 }),
    ...render(
      <QueryClientProvider client={qc}>
        <UserRow user={user} />
      </QueryClientProvider>,
    ),
  };
}

/** Open the role Select and pick an option by its visible label. */
async function chooseRole(u: ReturnType<typeof userEvent.setup>, label: string) {
  await u.click(screen.getByRole("combobox", { name: /role/i }));
  await u.click(await screen.findByRole("option", { name: label }));
}

describe("UserRow identity", () => {
  it("shows the name, email, role badge and key status", () => {
    renderRow(streamer);
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("grace@example.com")).toBeInTheDocument();
    // role is shown (as the badge + the picker value); key status badge is unique
    expect(screen.getAllByText("streamer").length).toBeGreaterThan(0);
    expect(screen.getByText(/key set/i)).toBeInTheDocument();
  });

  it("captions what a streamer key is for (live ingest during scheduled live shows)", () => {
    renderRow(admin);
    expect(screen.getByText(/authenticates.*live ingest.*live show/i)).toBeInTheDocument();
  });
});

describe("UserRow streamer key (shown once)", () => {
  it("reveals a freshly issued key exactly once, then dismiss makes it gone forever", async () => {
    mockApi.createStreamerKey.mockResolvedValue({
      userId: "u1",
      key: "sk_SUPERSECRET",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const { user } = renderRow(admin);

    expect(screen.queryByText("sk_SUPERSECRET")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /issue key/i }));

    expect(await screen.findByText("sk_SUPERSECRET")).toBeInTheDocument();
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    expect(mockApi.createStreamerKey).toHaveBeenCalledWith("u1");

    await user.click(screen.getByRole("button", { name: /done/i }));
    expect(screen.queryByText("sk_SUPERSECRET")).not.toBeInTheDocument();
  });

  it("copies the plaintext key to the clipboard", async () => {
    mockApi.createStreamerKey.mockResolvedValue({
      userId: "u1",
      key: "sk_SUPERSECRET",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const { user } = renderRow(admin);
    // Install the clipboard spy after render — userEvent.setup() attaches its own.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await user.click(screen.getByRole("button", { name: /issue key/i }));
    await screen.findByText("sk_SUPERSECRET");
    await user.click(screen.getByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith("sk_SUPERSECRET");
  });

  it("labels the action Regenerate when the user already has a key", () => {
    renderRow(streamer);
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /issue key/i })).not.toBeInTheDocument();
  });

  it("revokes an existing key only after confirmation", async () => {
    mockApi.revokeStreamerKey.mockResolvedValue(undefined as unknown as Response);
    const { user } = renderRow(streamer);

    await user.click(screen.getByRole("button", { name: /revoke/i }));
    // The confirm dialog action performs the revoke.
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /revoke/i }));

    await waitFor(() => expect(mockApi.revokeStreamerKey).toHaveBeenCalledWith("u2"));
  });
});

describe("UserRow role changes", () => {
  it("promotes a streamer to admin immediately, without a confirm dialog", async () => {
    mockApi.setRole.mockResolvedValue({ ...streamer, role: "admin" });
    const { user } = renderRow(streamer);

    await chooseRole(user, "admin");

    await waitFor(() => expect(mockApi.setRole).toHaveBeenCalledWith("u2", "admin"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("confirms before demoting an admin, then patches the role", async () => {
    mockApi.setRole.mockResolvedValue({ ...admin, role: "streamer" });
    const { user } = renderRow(admin);

    await chooseRole(user, "streamer");

    // No mutation until the operator confirms.
    expect(mockApi.setRole).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /demote/i }));

    await waitFor(() => expect(mockApi.setRole).toHaveBeenCalledWith("u1", "streamer"));
  });

  it("surfaces the 409 last-admin error verbatim", async () => {
    mockApi.setRole.mockRejectedValue(new Error("cannot demote the last admin"));
    const { user } = renderRow(admin);

    await chooseRole(user, "streamer");
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /demote/i }));

    expect(await screen.findByText("cannot demote the last admin")).toBeInTheDocument();
  });
});
