import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { ScheduleService } from "../shows/schedule.service";
import { StreamKeysService } from "../channels/stream-keys.service";
import { env } from "../config/env";

/** Result of a harbor source-auth check. `userId` is set only when a per-user key matched. */
export interface StreamerAuthResult {
  ok: boolean;
  userId?: string;
}

/** What was accepted on a mount most recently — the connect→status correlation. */
interface Accepted {
  userId: string;
  address?: string;
  expiresAt: number;
}

/** How long an accepted-connection record lives (correlates the auth hook with the
 *  following /internal/status connect, which carries no user identity). */
const ACCEPTED_TTL_MS = 10 * 60_000; // 10 minutes

/**
 * Schedule-aware, enforced-by-default streamer ingest auth (ADR D18, plan Phase D).
 * Replaces "advisory by default": a source may go live only during a live show
 * assigned to the key's owner.
 *
 * verify() flow for (mount, password):
 *   1. Resolve the channel by mount; deny if unknown or killed (isActive=false, D10).
 *   2. Identify the user by constant-time bcrypt-compare against every per-user
 *      StreamerKey (linear scan — fine at this scale; each compare is constant-time).
 *   3. If a user matched:
 *        - enforceSchedule=true  → allow only if the user owns a live show active in
 *          the grace window (ScheduleService.activeLiveShowFor). Admins are NOT
 *          exempt — verify() never inspects role, so enforcement is purely
 *          schedule-driven and therefore predictable for every operator.
 *        - enforceSchedule=false → any valid user key works anytime (opt-in advisory).
 *   4. If NO user key matched → fall back to the legacy per-channel StreamKey
 *      (back-compat, advisory): {ok:true} with no user identity.
 *
 * On an accepted connection with an identified user, record lastAccepted(mount) so
 * the subsequent status hook can attribute the StreamSession to that streamer.
 */
@Injectable()
export class StreamerAuthService {
  private readonly accepted = new Map<string, Accepted>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
    private readonly legacyStreamKeys: StreamKeysService,
  ) {}

  async verify(mount: string, password: string, address?: string): Promise<StreamerAuthResult> {
    const channel = await this.prisma.channel.findUnique({
      where: { mount },
      select: { id: true, isActive: true, enforceSchedule: true },
    });
    if (!channel || !channel.isActive) return { ok: false };

    const userId = await this.identifyUser(password);

    if (userId) {
      if (channel.enforceSchedule) {
        const show = await this.schedule.activeLiveShowFor(
          channel.id,
          userId,
          new Date(),
          env.schedule.graceMin,
        );
        if (!show) return { ok: false };
      }
      this.record(mount, userId, address);
      return { ok: true, userId };
    }

    // No per-user key matched — fall back to the legacy per-channel key (advisory,
    // no user identity). Nothing is recorded: there is no streamer to attribute.
    if (await this.legacyStreamKeys.verify(mount, password)) return { ok: true, userId: undefined };
    return { ok: false };
  }

  /** The user last accepted on `mount`, if still within the TTL; else null. TTL-evicted
   *  lazily on access. A valid entry is NOT cleared by reading — only expiry removes it. */
  lastAccepted(mount: string): { userId: string; address?: string } | null {
    const entry = this.accepted.get(mount);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.accepted.delete(mount);
      return null;
    }
    return entry.address !== undefined
      ? { userId: entry.userId, address: entry.address }
      : { userId: entry.userId };
  }

  /** Constant-time bcrypt-compare the presented secret against every per-user key. */
  private async identifyUser(password: string): Promise<string | undefined> {
    const keys = await this.prisma.streamerKey.findMany();
    for (const k of keys) {
      if (await bcrypt.compare(password, k.keyHash)) return k.userId;
    }
    return undefined;
  }

  private record(mount: string, userId: string, address?: string): void {
    this.accepted.set(mount, { userId, address, expiresAt: Date.now() + ACCEPTED_TTL_MS });
  }
}
