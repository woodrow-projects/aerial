import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Per-stream session log (ADR D10: "per-stream logging (mount/time/source IP)").
 * Driven by the Liquidsoap /internal/status connect/disconnect hook: opens a
 * StreamSession when a streamer goes live, closes it on disconnect.
 *
 * Best-effort by design — every write is wrapped so a persistence failure is
 * logged, never thrown: the auth/status hooks must keep answering Liquidsoap
 * even if the DB is unavailable (the audio path must not depend on this log).
 *
 * LIMITATION: sourceIp is not currently obtainable. The status hook payload
 * carries only {slug, live}; the streamer's ingest address is known to
 * Liquidsoap (harbor `req.address`) but the engine template — owned elsewhere —
 * does not forward it. The `open(sourceIp)` seam is ready for when it does; it
 * is stored null until then.
 */
@Injectable()
export class SessionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Crash recovery: close sessions left open by a previous, unclean shutdown. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const { count } = await this.prisma.streamSession.updateMany({
        where: { endedAt: null },
        data: { endedAt: new Date() },
      });
      if (count > 0) this.logger.warn(`Swept ${count} session(s) left open by a prior crash`);
    } catch (err) {
      this.logger.error(`Session sweep on bootstrap failed: ${String(err)}`);
    }
  }

  /** Streamer connected: open a session, first closing any stale open one for the channel. */
  async open(slug: string, sourceIp: string | null = null): Promise<void> {
    try {
      const channel = await this.prisma.channel.findUnique({ where: { slug } });
      if (!channel) {
        this.logger.warn(`Ignoring connect for unknown channel "${slug}"`);
        return;
      }
      // Double-connect hygiene: close any dangling open session before opening a new one.
      await this.prisma.streamSession.updateMany({
        where: { channelId: channel.id, endedAt: null },
        data: { endedAt: new Date() },
      });
      await this.prisma.streamSession.create({
        data: { channelId: channel.id, mount: channel.mount, sourceIp },
      });
    } catch (err) {
      this.logger.error(`Failed to open session for "${slug}": ${String(err)}`);
    }
  }

  /** Streamer disconnected: close the most recent open session (tolerant of none). */
  async close(slug: string): Promise<void> {
    try {
      const channel = await this.prisma.channel.findUnique({ where: { slug } });
      if (!channel) return;
      const open = await this.prisma.streamSession.findFirst({
        where: { channelId: channel.id, endedAt: null },
        orderBy: { startedAt: "desc" },
      });
      if (!open) return; // a disconnect with no open session is a no-op, never an error
      await this.prisma.streamSession.update({
        where: { id: open.id },
        data: { endedAt: new Date() },
      });
    } catch (err) {
      this.logger.error(`Failed to close session for "${slug}": ${String(err)}`);
    }
  }
}
