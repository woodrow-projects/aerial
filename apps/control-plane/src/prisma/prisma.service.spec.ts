import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "./prisma.service";

describe("PrismaService", () => {
  let service: PrismaService;
  let connect: ReturnType<typeof vi.fn>;
  let queryRawUnsafe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.DATABASE_URL = "file:./test-scratch.db";
    service = new PrismaService();
    connect = vi.fn().mockResolvedValue(undefined);
    queryRawUnsafe = vi.fn().mockResolvedValue([]);
    Object.assign(service, { $connect: connect, $queryRawUnsafe: queryRawUnsafe });
  });

  it("connects and applies the SQLite pragmas on module init", async () => {
    await service.onModuleInit();

    expect(connect).toHaveBeenCalledOnce();
    const pragmas = queryRawUnsafe.mock.calls.map(([sql]) => sql as string);
    expect(pragmas).toEqual([
      "PRAGMA journal_mode=WAL;",
      "PRAGMA busy_timeout=5000;",
      "PRAGMA synchronous=NORMAL;",
    ]);
  });
});
