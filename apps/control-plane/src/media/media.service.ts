import {
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createWriteStream, promises as fsp } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import * as path from "node:path";
import type { CreateTrackMetaInput } from "@aerial/shared";
import { PrismaService } from "../prisma/prisma.service";
import { env } from "../config/env";
import { ffprobe, type ProbeResult } from "./ffprobe";

/** A file arriving on the upload route. `originalName` is the client-supplied name —
 *  used ONLY for the extension, the slug base, and the title fallback; NEVER as a path. */
export interface IncomingMediaFile {
  originalName: string;
  stream: Readable;
}

/** A media library track surfaced to the SPA / clock editor. */
export interface TrackDto {
  id: string;
  fileName: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationSec: number;
  cueIn: number;
  cueOut: number | null;
  fadeIn: number;
  fadeOut: number;
  amplifyDb: number;
  createdAt: string;
  updatedAt: string;
}

interface TrackRow {
  id: string;
  fileName: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationSec: number;
  cueIn: number;
  cueOut: number | null;
  fadeIn: number;
  fadeOut: number;
  amplifyDb: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Extensions we accept into the library (audio containers Liquidsoap can decode). */
const ALLOWED_EXTENSIONS = new Set(["mp3", "m4a", "aac", "flac", "ogg", "wav"]);

/** Track metadata columns a PATCH may touch (must exist on createTrackMetaSchema). */
const PATCHABLE_KEYS = [
  "title",
  "artist",
  "album",
  "cueIn",
  "cueOut",
  "fadeIn",
  "fadeOut",
  "amplifyDb",
] as const;

/**
 * Media library (plan Phase A / ADR D17). Uploads stream to the media volume under a
 * server-generated, path-traversal-safe filename; ffprobe seeds duration + tags; a
 * Track row is created. Reads are open to any operator; the controller gates mutations
 * to admins.
 */
@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<TrackDto[]> {
    const rows = await this.prisma.track.findMany({ orderBy: { title: "asc" } });
    return rows.map((r: TrackRow) => this.toDto(r));
  }

  async create(file: IncomingMediaFile): Promise<TrackDto> {
    const ext = this.extension(file.originalName); // throws 415 before any write
    const base = path.basename(file.originalName, path.extname(file.originalName));
    const fileName = this.safeFileName(base, ext);

    const root = env.engine.mediaRoot;
    await fsp.mkdir(root, { recursive: true });
    const destPath = path.join(root, fileName);

    // Stream to disk. On a mid-write error (incl. the multipart size cap) clean up the
    // partial file; the size-limit case surfaces as 413.
    try {
      await pipeline(file.stream, createWriteStream(destPath));
    } catch (err) {
      await this.unlinkQuietly(fileName);
      if (this.isTooLarge(err)) {
        throw new PayloadTooLargeException(`file exceeds the ${env.media.uploadMaxMb} MB upload limit`);
      }
      throw err;
    }
    if ((file.stream as { truncated?: boolean }).truncated) {
      await this.unlinkQuietly(fileName);
      throw new PayloadTooLargeException(`file exceeds the ${env.media.uploadMaxMb} MB upload limit`);
    }

    let probe: ProbeResult;
    try {
      probe = await ffprobe(destPath);
    } catch (err) {
      await this.unlinkQuietly(fileName);
      throw new UnprocessableEntityException(
        `could not read media metadata (ffprobe failed): ${(err as Error).message}`,
      );
    }

    try {
      const row = (await this.prisma.track.create({
        data: {
          fileName,
          title: probe.title ?? base,
          artist: probe.artist,
          album: probe.album,
          durationSec: probe.durationSec,
        },
      })) as TrackRow;
      return this.toDto(row);
    } catch (err) {
      // Keep the volume clean if the row can't be written (e.g. a rare filename clash).
      await this.unlinkQuietly(fileName);
      throw err;
    }
  }

  async update(id: string, input: CreateTrackMetaInput): Promise<TrackDto> {
    const existing = await this.prisma.track.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("track not found");

    // Copy only provided keys so a PATCH is partial; keep explicit null (clears
    // artist/album/cueOut) — `?? undefined` would wrongly drop those.
    const data: Prisma.TrackUpdateInput = {};
    for (const key of PATCHABLE_KEYS) {
      if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
    }

    const row = (await this.prisma.track.update({ where: { id }, data })) as TrackRow;
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    const existing = (await this.prisma.track.findUnique({ where: { id } })) as TrackRow | null;
    if (!existing) throw new NotFoundException("track not found");

    // PlaylistTrack rows cascade-delete with the Track (schema onDelete: Cascade). A
    // playlist left empty by this is legal — empty playlists are valid, no last-track guard.
    await this.prisma.track.delete({ where: { id } });
    await this.unlinkQuietly(existing.fileName);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Lower-cased extension without the dot; 415 if not whitelisted. */
  private extension(originalName: string): string {
    const ext = path.extname(path.basename(originalName)).slice(1).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new UnsupportedMediaTypeException(
        `unsupported media type ".${ext}" — allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
      );
    }
    return ext;
  }

  /**
   * Server-generated storage name: a slug of the client base name + a short random
   * suffix + the whitelisted extension. The result matches `[a-z0-9-]+-<hex8>.<ext>`,
   * so it can never contain a path separator or `..` — traversal-safe by construction.
   */
  private safeFileName(base: string, ext: string): string {
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "track";
    const suffix = randomBytes(4).toString("hex"); // 8 hex chars
    return `${slug}-${suffix}.${ext}`;
  }

  private async unlinkQuietly(fileName: string): Promise<void> {
    try {
      await fsp.unlink(path.join(env.engine.mediaRoot, fileName));
    } catch {
      // best-effort: the file may already be gone or never fully written
    }
  }

  private isTooLarge(err: unknown): boolean {
    const e = err as { code?: string; statusCode?: number } | null;
    return e?.code === "FST_REQ_FILE_TOO_LARGE" || e?.statusCode === 413;
  }

  private toDto(t: TrackRow): TrackDto {
    return {
      id: t.id,
      fileName: t.fileName,
      title: t.title,
      artist: t.artist ?? null,
      album: t.album ?? null,
      durationSec: t.durationSec,
      cueIn: t.cueIn,
      cueOut: t.cueOut ?? null,
      fadeIn: t.fadeIn,
      fadeOut: t.fadeOut,
      amplifyDb: t.amplifyDb,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}
