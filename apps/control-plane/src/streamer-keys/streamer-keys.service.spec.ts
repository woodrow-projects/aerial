import { NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamerKeysService } from "./streamer-keys.service";

/**
 * Per-user streamer-key issuance (ADR D18 / plan Phase D). Prisma is mocked — these
 * pin the security contract (plaintext shown once, only a bcrypt hash stored,
 * regenerate replaces the old key) without a database.
 */
function mockPrisma() {
  return {
    user: { findUnique: vi.fn() },
    streamerKey: {
      upsert: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe("StreamerKeysService.create", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let service: StreamerKeysService;

  beforeEach(() => {
    prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({ id: "u1", name: "Ann", email: "a@x.io", role: "streamer" });
    // Echo back an upserted row so the DTO can be shaped from it.
    prisma.streamerKey.upsert.mockImplementation(
      ({ create, update }: { create?: { userId: string; keyHash: string }; update?: { keyHash: string } }) =>
        Promise.resolve({
          id: "srk_1",
          userId: create?.userId ?? "u1",
          keyHash: (create ?? update)!.keyHash,
          createdAt: new Date(0),
        }),
    );
    service = new StreamerKeysService(prisma as never);
  });

  it("returns the plaintext key exactly once, tied to the user", async () => {
    const out = await service.create("u1");
    expect(out.key).toBeTruthy();
    expect(out.userId).toBe("u1");
    expect(out.createdAt).toBe(new Date(0).toISOString());
  });

  it("persists only a bcrypt hash — never the plaintext key", async () => {
    const out = await service.create("u1");
    const arg = prisma.streamerKey.upsert.mock.calls[0][0];
    const storedHash = arg.create.keyHash;

    expect(storedHash).not.toBe(out.key);
    expect(storedHash.startsWith("$2")).toBe(true);
    expect(await bcrypt.compare(out.key, storedHash)).toBe(true);
    // upsert is keyed on the unique userId so regenerate replaces in place.
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.update.keyHash).toBe(storedHash);
  });

  it("issues a high-entropy base64url key (>=32 chars)", async () => {
    const out = await service.create("u1");
    expect(out.key.length).toBeGreaterThanOrEqual(32);
    expect(out.key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("regenerate replaces the key — the previous plaintext no longer verifies", async () => {
    const first = await service.create("u1");
    const firstHash = prisma.streamerKey.upsert.mock.calls[0][0].create.keyHash;
    const second = await service.create("u1");
    const secondHash = prisma.streamerKey.upsert.mock.calls[1][0].create.keyHash;

    expect(second.key).not.toBe(first.key);
    expect(secondHash).not.toBe(firstHash);
    // The old plaintext is dead against the new stored hash.
    expect(await bcrypt.compare(first.key, secondHash)).toBe(false);
    expect(await bcrypt.compare(second.key, secondHash)).toBe(true);
  });

  it("404s when the target user does not exist (no orphan keys)", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.create("ghost")).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.streamerKey.upsert).not.toHaveBeenCalled();
  });
});

describe("StreamerKeysService.revoke", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let service: StreamerKeysService;

  beforeEach(() => {
    prisma = mockPrisma();
    service = new StreamerKeysService(prisma as never);
  });

  it("deletes the user's key by userId", async () => {
    await service.revoke("u1");
    expect(prisma.streamerKey.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("is idempotent — revoking a user with no key does not throw", async () => {
    prisma.streamerKey.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.revoke("u1")).resolves.toBeUndefined();
  });
});
