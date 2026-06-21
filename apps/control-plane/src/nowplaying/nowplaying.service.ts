import { Injectable, Logger } from "@nestjs/common";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NowPlayingDto } from "@aerial/shared";
import { env } from "../config/env";

interface State {
  title: string;
  artist: string;
  live: boolean;
  updatedAt: string;
}

/**
 * Owns now-playing metadata + live (streamer-on-air) state (ADR D8). On every change it writes
 * a cacheable `nowplaying.json` into the channel's HLS dir so the CDN/Caddy can
 * serve it to operators' own frontends alongside the segments.
 */
@Injectable()
export class NowPlayingService {
  private readonly logger = new Logger(NowPlayingService.name);
  private readonly state = new Map<string, State>();

  private now(): string {
    // process-local timestamp; fine for "updatedAt"
    return new Date().toISOString();
  }

  private get(slug: string): State {
    return this.state.get(slug) ?? { title: "", artist: "", live: false, updatedAt: this.now() };
  }

  update(slug: string, title: string, artist: string): void {
    const next: State = { ...this.get(slug), title, artist, updatedAt: this.now() };
    this.state.set(slug, next);
    this.persist(slug, next);
  }

  setLive(slug: string, live: boolean): void {
    const next: State = { ...this.get(slug), live, updatedAt: this.now() };
    this.state.set(slug, next);
    this.persist(slug, next);
  }

  isLive(slug: string): boolean {
    return this.get(slug).live;
  }

  read(slug: string): NowPlayingDto {
    const s = this.get(slug);
    return { title: s.title, artist: s.artist, live: s.live, updatedAt: s.updatedAt };
  }

  private persist(slug: string, s: State): void {
    try {
      const dir = join(env.engine.hlsRoot, slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "nowplaying.json"), JSON.stringify(this.read(slug)));
    } catch (err) {
      this.logger.warn(`Failed to write nowplaying.json for ${slug}: ${String(err)}`);
    }
  }
}
