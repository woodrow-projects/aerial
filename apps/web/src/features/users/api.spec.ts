import { describe, it, expect, vi, afterEach } from "vitest";
import { usersApi } from "./api";

/**
 * Fetch-layer behaviour for the users feature. The hook specs mock this client,
 * so this is the one place the real `fetch` wrappers are exercised — specifically
 * that a failed mutation *throws* (so the screens' ErrorNote can surface it). The
 * DELETE revoke is the risky one: it returns 204 (no body) on success, so it must
 * signal failure without trying to parse an empty body.
 */
afterEach(() => vi.restoreAllMocks());

function stubFetch(res: Response) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
}

describe("usersApi.revokeStreamerKey", () => {
  it("resolves on a 204 no-content success", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(usersApi.revokeStreamerKey("u1")).resolves.not.toThrow();
  });

  it("throws the server message when revoke is forbidden (403) so it surfaces via ErrorNote", async () => {
    stubFetch(
      new Response(JSON.stringify({ message: "Forbidden resource" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(usersApi.revokeStreamerKey("u1")).rejects.toThrow("Forbidden resource");
  });

  it("throws a status fallback when a failed revoke has no JSON body", async () => {
    stubFetch(new Response(null, { status: 500, statusText: "Internal Server Error" }));
    await expect(usersApi.revokeStreamerKey("u1")).rejects.toThrow(/500/);
  });
});
