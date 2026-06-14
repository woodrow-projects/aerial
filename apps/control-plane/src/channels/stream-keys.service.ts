import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import * as bcrypt from "bcryptjs";
import type { StreamKeyCreatedDto, StreamKeyDto } from "@aerial/shared";
import { PrismaService } from "../prisma/prisma.service";

const BCRYPT_ROUNDS = 12;

/**
 * Stream-key issuance + verification (ADR D10). Keys are server-generated,
 * high-entropy, and stored only as bcrypt hashes. The plaintext is returned
 * exactly once, on creation.
 */
@Injectable()
export class StreamKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async create(channelId: string): Promise<StreamKeyCreatedDto> {
    const key = randomBytes(24).toString("base64url"); // ~192 bits
    const keyHash = await bcrypt.hash(key, BCRYPT_ROUNDS);
    const row = await this.prisma.streamKey.create({ data: { channelId, keyHash } });
    return { id: row.id, channelId: row.channelId, key, createdAt: row.createdAt.toISOString() };
  }

  async list(channelId: string): Promise<StreamKeyDto[]> {
    const rows = await this.prisma.streamKey.findMany({ where: { channelId }, orderBy: { createdAt: "desc" } });
    return rows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async revoke(keyId: string): Promise<void> {
    await this.prisma.streamKey.update({ where: { id: keyId }, data: { isActive: false } });
  }

  /** Verify a plaintext key presented on the source connection against a mount. */
  async verify(mount: string, plaintext: string): Promise<boolean> {
    const channel = await this.prisma.channel.findUnique({
      where: { mount },
      include: { streamKeys: { where: { isActive: true } } },
    });
    if (!channel || !channel.isActive) return false;

    for (const sk of channel.streamKeys) {
      // constant-time within bcrypt.compare; iterate active keys
      if (await bcrypt.compare(plaintext, sk.keyHash)) {
        await this.prisma.streamKey.update({ where: { id: sk.id }, data: { lastUsedAt: new Date() } });
        return true;
      }
    }
    return false;
  }
}
