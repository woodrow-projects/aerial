import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Channel } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { env } from "../config/env";
import { buildLiquidsoapScript, type LiquidsoapParams } from "./liq-template";

const RESTART_DELAY_MS = 3000;

/**
 * Supervises one Liquidsoap child process per active channel (ADR D5/D6):
 * generates the script, spawns the process, streams logs, and restarts on
 * crash. Lifecycle is tied to the Nest app (boot all on start, drain on stop).
 */
@Injectable()
export class EngineService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EngineService.name);
  private readonly procs = new Map<string, ChildProcess>(); // channelId -> process
  private readonly stopping = new Set<string>(); // channelIds we intentionally stopped

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    mkdirSync(env.engine.configRoot, { recursive: true });
    const channels = await this.prisma.channel.findMany({ where: { isActive: true } });
    this.logger.log(`Starting ${channels.length} active channel(s)`);
    for (const channel of channels) this.startChannel(channel);
  }

  onModuleDestroy(): void {
    for (const [channelId, proc] of this.procs) {
      this.stopping.add(channelId);
      proc.kill("SIGTERM");
    }
  }

  /** Start or restart a channel's engine to match its current config. */
  syncChannel(channel: Channel): void {
    if (!channel.isActive) {
      this.stopChannel(channel.id);
      return;
    }
    this.restartChannel(channel);
  }

  restartChannel(channel: Channel): void {
    this.stopChannel(channel.id);
    // brief delay so the harbor port frees before re-bind
    setTimeout(() => this.startChannel(channel), 500);
  }

  stopChannel(channelId: string): void {
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
    writeFileSync(configPath, buildLiquidsoapScript(params));

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
      this.logger.error(`Liquidsoap "${channel.slug}" exited (code ${code}); restarting in ${RESTART_DELAY_MS}ms`);
      setTimeout(() => void this.restartIfStillActive(channel.id), RESTART_DELAY_MS);
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
      hlsBitrates: channel.hlsBitrates,
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
