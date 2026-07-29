import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";

const BCRYPT_ROUNDS = 12;

/** Returned exactly once on creation — the plaintext key is never stored or shown again. */
export interface StreamerKeyCreatedDto {
  userId: string;
  key: string; // plaintext, shown once
  createdAt: string;
}

/**
 * Per-user streamer-key issuance (ADR D18 / plan Phase D). A streaming User has ONE
 * streamer key (StreamerKey.userId is unique); it authenticates their live source at
 * ingest. Keys are server-generated, high-entropy, and stored only as bcrypt hashes
 * (ADR D10) — the plaintext is surfaced exactly once, on creation. Regenerating
 * upserts in place so the previous key dies immediately.
 */
@Injectable()
export class StreamerKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /** Issue (or regenerate) the streamer key for a user. Returns the plaintext once. */
  async create(userId: string): Promise<StreamerKeyCreatedDto> {
    // Guard against orphan keys: a StreamerKey whose userId has no User would
    // identify a ghost streamer at ingest. StreamerKey.userId is a scalar (no FK,
    // better-auth owns User), so existence is enforced here in the service layer.
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("user not found");

    const key = randomBytes(24).toString("base64url"); // ~192 bits
    const keyHash = await bcrypt.hash(key, BCRYPT_ROUNDS);
    // Upsert on the unique userId: create if none, else replace the hash (regenerate).
    // createdAt is refreshed to now so it reflects the current key's issuance.
    const row = await this.prisma.streamerKey.upsert({
      where: { userId },
      create: { userId, keyHash },
      update: { keyHash, createdAt: new Date() },
    });
    return { userId: row.userId, key, createdAt: row.createdAt.toISOString() };
  }

  /** Revoke a user's streamer key. Idempotent — a no-op if the user has none. */
  async revoke(userId: string): Promise<void> {
    await this.prisma.streamerKey.deleteMany({ where: { userId } });
  }
}
