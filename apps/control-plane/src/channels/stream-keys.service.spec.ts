import { beforeEach, describe, expect, it, vi } from "vitest";
import * as bcrypt from "bcryptjs";
import { StreamKeysService } from "./stream-keys.service";

/**
 * Unit tests for stream-key issuance + verification (ADR D10). Prisma is mocked
 * — these assert the security contract (plaintext returned once, only a hash
 * stored, mount/key verification) without a database.
 */
function mockPrisma() {
  return {
    streamKey: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    channel: {
      findUnique: vi.fn(),
    },
  };
}

describe("StreamKeysService.create", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let service: StreamKeysService;

  beforeEach(() => {
    prisma = mockPrisma();
    prisma.streamKey.create.mockImplementation(({ data }: { data: { channelId: string; keyHash: string } }) =>
      Promise.resolve({ id: "sk_1", channelId: data.channelId, keyHash: data.keyHash, createdAt: new Date(0) }),
    );
    service = new StreamKeysService(prisma as never);
  });

  it("returns the plaintext key exactly once on creation", async () => {
    const result = await service.create("chan_1");
    expect(result.key).toBeTruthy();
    expect(result.channelId).toBe("chan_1");
  });

  it("persists only a bcrypt hash — never the plaintext key", async () => {
    const result = await service.create("chan_1");
    const stored = prisma.streamKey.create.mock.calls[0][0].data.keyHash;

    expect(stored).not.toBe(result.key);
    expect(stored.startsWith("$2")).toBe(true); // bcrypt hash prefix
    expect(await bcrypt.compare(result.key, stored)).toBe(true);
  });

  it("issues a high-entropy key (>=32 chars of base64url)", async () => {
    const result = await service.create("chan_1");
    expect(result.key.length).toBeGreaterThanOrEqual(32);
    expect(result.key).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("StreamKeysService.verify", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let service: StreamKeysService;
  const PLAINTEXT = "correct-horse-battery-staple";
  let hash: string;

  beforeEach(async () => {
    prisma = mockPrisma();
    service = new StreamKeysService(prisma as never);
    hash = await bcrypt.hash(PLAINTEXT, 4); // low cost — test speed only
  });

  it("returns false when the mount has no channel", async () => {
    prisma.channel.findUnique.mockResolvedValue(null);
    expect(await service.verify("/ghost", PLAINTEXT)).toBe(false);
  });

  it("returns false when the channel is inactive (kill switch)", async () => {
    prisma.channel.findUnique.mockResolvedValue({
      isActive: false,
      streamKeys: [{ id: "sk_1", keyHash: hash }],
    });
    expect(await service.verify("/jazz", PLAINTEXT)).toBe(false);
  });

  it("returns false when no active key matches the presented secret", async () => {
    prisma.channel.findUnique.mockResolvedValue({
      isActive: true,
      streamKeys: [{ id: "sk_1", keyHash: await bcrypt.hash("a-different-key", 4) }],
    });
    expect(await service.verify("/jazz", PLAINTEXT)).toBe(false);
  });

  it("returns true and stamps lastUsedAt when a key matches", async () => {
    prisma.channel.findUnique.mockResolvedValue({
      isActive: true,
      streamKeys: [{ id: "sk_match", keyHash: hash }],
    });

    expect(await service.verify("/jazz", PLAINTEXT)).toBe(true);
    expect(prisma.streamKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sk_match" } }),
    );
  });
});
