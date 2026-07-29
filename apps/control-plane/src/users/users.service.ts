import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Role } from "../auth/roles";

/** Operator summary for the admin user-management screen — never any secret material. */
export interface UserSummaryDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  hasStreamerKey: boolean;
}

/**
 * User/role administration (ADR D18). Roles gate the panel: `admin` has full control,
 * `streamer` is read-only + a streamer key. The one hard invariant is that the last
 * remaining admin cannot be demoted — that would strand the install with no one able
 * to perform any admin-only mutation.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** All operators with whether each holds a streamer key (one lookup, not N). */
  async list(): Promise<UserSummaryDto[]> {
    const [users, keys] = await Promise.all([
      this.prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.streamerKey.findMany({ select: { userId: true } }),
    ]);
    const keyed = new Set(keys.map((k) => k.userId));
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role as Role,
      hasStreamerKey: keyed.has(u.id),
    }));
  }

  /** Set a user's role. 404 if unknown; 409 if it would demote the last admin. */
  async setRole(userId: string, role: Role): Promise<UserSummaryDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("user not found");

    // Demoting an admin is only allowed while another admin remains.
    if (user.role === "admin" && role !== "admin") {
      const admins = await this.prisma.user.count({ where: { role: "admin" } });
      if (admins <= 1) throw new ConflictException("cannot demote the last admin");
    }

    const updated = await this.prisma.user.update({ where: { id: userId }, data: { role } });
    const key = await this.prisma.streamerKey.findUnique({ where: { userId } });
    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role as Role,
      hasStreamerKey: key !== null,
    };
  }
}
