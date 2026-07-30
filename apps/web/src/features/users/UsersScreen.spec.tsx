import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
import { UsersScreen } from "./UsersScreen";

const mockApi = vi.mocked(usersApi);

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UsersScreen />
    </QueryClientProvider>,
  );
}

const users: UserSummary[] = [
  { id: "u1", name: "Ada", email: "ada@example.com", role: "admin", hasStreamerKey: false },
  { id: "u2", name: "Grace", email: "grace@example.com", role: "streamer", hasStreamerKey: true },
];

describe("UsersScreen", () => {
  it("renders a row for each user in the list", async () => {
    mockApi.list.mockResolvedValue(users);
    renderScreen();
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
  });

  it("shows an empty state when there are no users", async () => {
    mockApi.list.mockResolvedValue([]);
    renderScreen();
    expect(await screen.findByText(/no users/i)).toBeInTheDocument();
  });

  it("surfaces a list-load error", async () => {
    mockApi.list.mockRejectedValue(new Error("boom"));
    renderScreen();
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});
