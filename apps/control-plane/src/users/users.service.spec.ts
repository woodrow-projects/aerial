import { ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersService } from "./users.service";

/**
 * Operator/user administration (ADR D18). Prisma is mocked. Covers the list
 * projection (with hasStreamerKey) and the role change — including the invariant
 * that the last remaining admin cannot be demoted (409), which would otherwise
 * lock the whole install out of every admin-only mutation.
 */
function mockPrisma() {
  return {
    user: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    streamerKey: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
  };
}

describe("UsersService.list", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let service: UsersService;

  beforeEach(() => {
    prisma = mockPrisma();
    service = new UsersService(prisma as never);
  });

  it("projects id/name/email/role + hasStreamerKey (never any secret material)", async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: "u1", name: "Ann", email: "ann@x.io", role: "admin" },
      { id: "u2", name: "Bo", email: "bo@x.io", role: "streamer" },
    ]);
    prisma.streamerKey.findMany.mockResolvedValue([{ userId: "u2" }]);

    const out = await service.list();

    expect(out).toEqual([
      { id: "u1", name: "Ann", email: "ann@x.io", role: "admin", hasStreamerKey: false },
      { id: "u2", name: "Bo", email: "bo@x.io", role: "streamer", hasStreamerKey: true },
    ]);
  });
});

describe("UsersService.setRole", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let service: UsersService;

  beforeEach(() => {
    prisma = mockPrisma();
    service = new UsersService(prisma as never);
    prisma.user.update.mockImplementation(({ where, data }: { where: { id: string }; data: { role: string } }) =>
      Promise.resolve({ id: where.id, name: "X", email: "x@x.io", role: data.role }),
    );
  });

  it("404s when the user does not exist", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.setRole("ghost", "admin")).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("promotes a streamer to admin", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u2", name: "Bo", email: "bo@x.io", role: "streamer" });

    const out = await service.setRole("u2", "admin");

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u2" }, data: { role: "admin" } });
    expect(out).toMatchObject({ id: "u2", role: "admin" });
    // A promotion never runs the last-admin count check.
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it("demotes an admin to streamer when other admins remain", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", name: "Ann", email: "ann@x.io", role: "admin" });
    prisma.user.count.mockResolvedValue(2);

    const out = await service.setRole("u1", "streamer");

    expect(prisma.user.count).toHaveBeenCalledWith({ where: { role: "admin" } });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { role: "streamer" } });
    expect(out).toMatchObject({ id: "u1", role: "streamer" });
  });

  it("409s when demoting the LAST admin (and does not write)", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", name: "Ann", email: "ann@x.io", role: "admin" });
    prisma.user.count.mockResolvedValue(1);

    await expect(service.setRole("u1", "streamer")).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("keeping an admin as admin is not a demotion — no count check, no 409", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", name: "Ann", email: "ann@x.io", role: "admin" });

    await service.setRole("u1", "admin");

    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { role: "admin" } });
  });

  it("includes hasStreamerKey in the returned summary", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u2", name: "Bo", email: "bo@x.io", role: "streamer" });
    prisma.streamerKey.findUnique.mockResolvedValue({ userId: "u2" });

    const out = await service.setRole("u2", "admin");
    expect(out.hasStreamerKey).toBe(true);
  });
});
