import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Channel } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parseDeliveryMode, parseHlsBitrates } from "../prisma/db-columns";
import { env } from "../config/env";
import { buildLiquidsoapScript, type LiquidsoapParams } from "./liq-template";

const RESTART_BASE_MS = 3000; // first retry delay
const RESTART_MAX_MS = 60000; // cap on the exponential backoff
const STABLE_MS = 60000; // a process up this long is "healthy" → reset backoff

/**
 * Supervises one Liquidsoap child process per active channel (ADR D5/D6):
 * generates the script, spawns the process, streams logs, and restarts on
 * crash with exponential backoff. Lifecycle is tied to the Nest app (boot all
 * on start, drain on stop).
 */
@Injectable()
export class EngineService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EngineService.name);
  private readonly procs = new Map<string, ChildProcess>(); // channelId -> process
  private readonly stopping = new Set<string>(); // channelIds we intentionally stopped
  private readonly restartCounts = new Map<string, number>(); // consecutive crash count
  // channelId -> the script text currently written to disk / running. Seeded from
  // the on-disk .liq on boot so an unchanged syncChannel skips the restart (and
  // the audio gap it causes) — we only restart when this text actually changes.
  private readonly scripts = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    mkdirSync(env.engine.configRoot, { recursive: true });
    const channels = await this.prisma.channel.findMany({ where: { isActive: true } });
    this.logger.log(`Starting ${channels.length} active channel(s)`);
    for (const channel of channels) {
      this.seedScriptFromDisk(channel);
      this.startChannel(channel);
    }
  }

  /** Seed the running-script cache from the existing .liq so boot won't needlessly rewrite/restart. */
  private seedScriptFromDisk(channel: Channel): void {
    const configPath = join(env.engine.configRoot, `${channel.slug}.liq`);
    try {
      if (existsSync(configPath)) this.scripts.set(channel.id, readFileSync(configPath, "utf8"));
    } catch (err) {
      // Unreadable/absent file → leave the cache empty; startChannel will write it.
      this.logger.warn(`Could not seed script for "${channel.slug}" from disk: ${String(err)}`);
    }
  }

  onModuleDestroy(): void {
    for (const [channelId, proc] of this.procs) {
      this.stopping.add(channelId);
      proc.kill("SIGTERM");
    }
  }

  /**
   * Reconcile a channel's engine with its current config. Restarts only when the
   * generated script text changes or on an isActive transition — an unrelated edit
   * that produces an identical script is a no-op, avoiding the audio gap a
   * kill+respawn causes. (Live library/queue changes never touch the script at
   * all: selection is control-plane-owned, D17.)
   */
  syncChannel(channel: Channel): void {
    if (!channel.isActive) {
      this.stopChannel(channel.id); // isActive transition → stop (never restart)
      return;
    }
    const script = buildLiquidsoapScript(this.buildParams(channel));
    // Only skip when a process is actually running the identical script; if nothing
    // is running (inactive→active, crash/backoff) we must (re)start it.
    if (this.procs.has(channel.id) && this.scripts.get(channel.id) === script) return;
    this.restartChannel(channel);
  }

  restartChannel(channel: Channel): void {
    this.stopChannel(channel.id);
    // brief delay so the harbor port frees before re-bind
    setTimeout(() => this.startChannel(channel), 500);
  }

  stopChannel(channelId: string): void {
    this.restartCounts.delete(channelId);
    const proc = this.procs.get(channelId);
    if (!proc) return;
    this.stopping.add(channelId);
    proc.kill("SIGTERM");
    this.procs.delete(channelId);
  }

  private startChannel(channel: Channel): void {
    if (this.procs.has(channel.id)) return;
    this.stopping.delete(channel.id);

    const params = this.buildParams(channel);
    mkdirSync(params.hlsDir, { recursive: true });
    mkdirSync(params.mediaDir, { recursive: true });

    const configPath = join(env.engine.configRoot, `${channel.slug}.liq`);
    const script = buildLiquidsoapScript(params);
    // Skip the write when the on-disk script already matches (seeded on boot) — the
    // cache tracks the running script so syncChannel can detect a real change.
    if (this.scripts.get(channel.id) !== script) {
      writeFileSync(configPath, script);
      this.scripts.set(channel.id, script);
    }

    const spawnedAt = Date.now();
    const proc = spawn(env.engine.liquidsoapBin, [configPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.procs.set(channel.id, proc);
    this.logger.log(`Spawned Liquidsoap for "${channel.slug}" (pid ${proc.pid}, harbor :${channel.harborPort})`);

    proc.stdout?.on("data", (d) => this.logger.debug(`[${channel.slug}] ${String(d).trim()}`));
    proc.stderr?.on("data", (d) => this.logger.warn(`[${channel.slug}] ${String(d).trim()}`));

    // e.g. ENOENT when the liquidsoap binary is missing (dev without the engine):
    // log and move on rather than crash the control plane.
    proc.on("error", (err) => {
      this.procs.delete(channel.id);
      this.logger.error(`Could not spawn Liquidsoap for "${channel.slug}": ${err.message}`);
    });

    proc.on("exit", (code) => {
      this.procs.delete(channel.id);
      if (this.stopping.has(channel.id)) {
        this.stopping.delete(channel.id);
        return;
      }
      // Exponential backoff, reset once a process has run long enough to be healthy.
      const wasHealthy = Date.now() - spawnedAt >= STABLE_MS;
      const count = (wasHealthy ? 0 : (this.restartCounts.get(channel.id) ?? 0)) + 1;
      this.restartCounts.set(channel.id, count);
      const delay = Math.min(RESTART_BASE_MS * 2 ** (count - 1), RESTART_MAX_MS);
      this.logger.error(`Liquidsoap "${channel.slug}" exited (code ${code}); restart #${count} in ${delay}ms`);
      setTimeout(() => void this.restartIfStillActive(channel.id), delay);
    });
  }

  private async restartIfStillActive(channelId: string): Promise<void> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (channel?.isActive) this.startChannel(channel);
  }

  private buildParams(channel: Channel): LiquidsoapParams {
    return {
      slug: channel.slug,
      name: channel.name,
      mount: channel.mount,
      harborPort: channel.harborPort,
      deliveryMode: parseDeliveryMode(channel.deliveryMode),
      hlsBitrates: parseHlsBitrates(channel.hlsBitrates),
      icecastBitrate: channel.icecastBitrate,
      hlsDir: join(env.engine.hlsRoot, channel.slug),
      mediaDir: join(env.engine.mediaRoot, channel.slug),
      icecastHost: env.icecast.host,
      icecastPort: env.icecast.port,
      icecastSourcePassword: env.icecast.sourcePassword,
      internalApiUrl: env.internal.apiUrl,
      internalToken: env.internal.token,
    };
  }
}
