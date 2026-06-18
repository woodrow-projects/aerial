import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Channel } from "@prisma/client";
import type { ChannelDto, ChannelEndpoints, CreateChannelInput, UpdateChannelInput } from "@aerial/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EngineService } from "../engine/engine.service";
import { NowPlayingService } from "../nowplaying/nowplaying.service";
import { CdnService } from "../cdn/cdn.service";
import { env } from "../config/env";

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly nowPlaying: NowPlayingService,
    private readonly cdn: CdnService,
  ) {}

  async list(): Promise<ChannelDto[]> {
    const channels = await this.prisma.channel.findMany({ orderBy: { createdAt: "asc" } });
    return channels.map((c) => this.toDto(c));
  }

  async get(id: string): Promise<ChannelDto> {
    const channel = await this.prisma.channel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException("channel not found");
    return this.toDto(channel);
  }

  async create(input: CreateChannelInput): Promise<ChannelDto> {
    const harborPort = await this.nextHarborPort();
    try {
      const channel = await this.prisma.channel.create({
        data: {
          name: input.name,
          slug: input.slug,
          mount: `/${input.slug}`,
          harborPort,
          deliveryMode: input.deliveryMode,
          hlsBitrates: input.hlsBitrates ?? [64, 128],
          icecastBitrate: input.icecastBitrate ?? 128,
        },
      });
      this.engine.syncChannel(channel);
      return this.toDto(channel);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("a channel with that slug already exists");
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateChannelInput): Promise<ChannelDto> {
    const existing = await this.prisma.channel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("channel not found");

    const channel = await this.prisma.channel.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        isActive: input.isActive ?? undefined,
        deliveryMode: input.deliveryMode ?? undefined,
        hlsBitrates: input.hlsBitrates ?? undefined,
        icecastBitrate: input.icecastBitrate ?? undefined,
      },
    });
    this.engine.syncChannel(channel);
    return this.toDto(channel);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.channel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("channel not found");
    this.engine.stopChannel(id);
    await this.prisma.channel.delete({ where: { id } });
  }

  /** Channels each take a dedicated harbor port from HARBOR_BASE_PORT upward. */
  private async nextHarborPort(): Promise<number> {
    const agg = await this.prisma.channel.aggregate({ _max: { harborPort: true } });
    const max = agg._max.harborPort;
    return max ? max + 1 : env.engine.harborBasePort;
  }

  private toDto(channel: Channel): ChannelDto {
    return {
      id: channel.id,
      name: channel.name,
      slug: channel.slug,
      isActive: channel.isActive,
      deliveryMode: channel.deliveryMode,
      hlsBitrates: channel.hlsBitrates,
      icecastBitrate: channel.icecastBitrate,
      mount: channel.mount,
      harborPort: channel.harborPort,
      endpoints: this.endpoints(channel),
      live: this.nowPlaying.isLive(channel.slug),
      createdAt: channel.createdAt.toISOString(),
      updatedAt: channel.updatedAt.toISOString(),
    };
  }

  private endpoints(channel: Channel): ChannelEndpoints {
    const origin = env.publicBaseUrl;
    // HLS (and its sidecar nowplaying.json) resolve to the CDN when it's active,
    // else the origin. Icecast + DJ ingest are ALWAYS origin-direct — never CDN the
    // persistent stream or the ingest path (ADR D2 hard rule, enforced here in code).
    const hlsBase = this.cdn.hlsBaseUrl();
    let ingestHost: string;
    try {
      ingestHost = new URL(origin).hostname;
    } catch {
      ingestHost = "localhost";
    }
    const emitHls = channel.deliveryMode === "hls" || channel.deliveryMode === "both";
    const emitIcecast = channel.deliveryMode === "icecast" || channel.deliveryMode === "both";
    return {
      hls: emitHls ? `${hlsBase}/hls/${channel.slug}/live.m3u8` : null,
      icecast: emitIcecast ? `${origin}/icecast/${channel.slug}` : null,
      nowPlaying: `${hlsBase}/hls/${channel.slug}/nowplaying.json`,
      ingest: {
        host: ingestHost,
        port: channel.harborPort,
        mount: channel.mount,
        username: "source",
        protocol: "icecast",
        tls: true, // Caddy terminates ingest TLS (D10)
      },
    };
  }
}
