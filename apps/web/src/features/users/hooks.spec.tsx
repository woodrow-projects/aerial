import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
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
import {
  usersKey,
  isDemotion,
  useUsers,
  useSetRole,
  useCreateStreamerKey,
  useRevokeStreamerKey,
} from "./hooks";

const mockApi = vi.mocked(usersApi);

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const admin: UserSummary = {
  id: "u1",
  name: "Ada",
  email: "ada@example.com",
  role: "admin",
  hasStreamerKey: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isDemotion", () => {
  it("is true only when an admin is dropped to a non-admin role", () => {
    expect(isDemotion("admin", "streamer")).toBe(true);
    expect(isDemotion("streamer", "admin")).toBe(false);
    expect(isDemotion("admin", "admin")).toBe(false);
    expect(isDemotion("streamer", "streamer")).toBe(false);
  });
});

describe("useUsers", () => {
  it("maps the users list response into query data", async () => {
    mockApi.list.mockResolvedValue([admin]);
    const { result } = renderHook(() => useUsers(), { wrapper: wrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([admin]);
    expect(mockApi.list).toHaveBeenCalledTimes(1);
  });
});

describe("useSetRole", () => {
  it("PATCHes the new role and invalidates the users query", async () => {
    mockApi.setRole.mockResolvedValue({ ...admin, role: "streamer" });
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSetRole(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync({ id: "u1", role: "streamer" });

    expect(mockApi.setRole).toHaveBeenCalledWith("u1", "streamer");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: usersKey });
  });

  it("surfaces the server error (e.g. the 409 last-admin message) to the caller", async () => {
    mockApi.setRole.mockRejectedValue(new Error("cannot demote the last admin"));
    const { result } = renderHook(() => useSetRole(), { wrapper: wrapper(makeClient()) });

    await expect(result.current.mutateAsync({ id: "u1", role: "streamer" })).rejects.toThrow(
      "cannot demote the last admin",
    );
  });
});

describe("useCreateStreamerKey", () => {
  it("issues a key for the user and invalidates the users query", async () => {
    mockApi.createStreamerKey.mockResolvedValue({
      userId: "u1",
      key: "sk_PLAINTEXT",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateStreamerKey(), { wrapper: wrapper(qc) });

    const created = await result.current.mutateAsync("u1");

    expect(mockApi.createStreamerKey).toHaveBeenCalledWith("u1");
    expect(created.key).toBe("sk_PLAINTEXT");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: usersKey });
  });
});

describe("useRevokeStreamerKey", () => {
  it("revokes the user's key and invalidates the users query", async () => {
    mockApi.revokeStreamerKey.mockResolvedValue(undefined as unknown as Response);
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRevokeStreamerKey(), { wrapper: wrapper(qc) });

    await result.current.mutateAsync("u1");

    expect(mockApi.revokeStreamerKey).toHaveBeenCalledWith("u1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: usersKey });
  });
});
