import { Controller, Delete, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { Roles, RolesGuard } from "../auth/roles";
import { StreamerKeysService } from "./streamer-keys.service";

/**
 * Per-user streamer-key management (ADR D18 / plan Phase D). Nested under a user so
 * the key is owned by that User (StreamerKey.userId is unique). Both routes are
 * admin-only — a streamer never mints or revokes keys (@Roles + @UseGuards).
 *   POST   /api/users/:id/streamer-key → generate/regenerate; returns plaintext once.
 *   DELETE /api/users/:id/streamer-key → revoke (idempotent).
 */
@Controller("api/users/:id")
@UseGuards(RolesGuard)
export class StreamerKeysController {
  constructor(private readonly keys: StreamerKeysService) {}

  @Post("streamer-key")
  @Roles("admin")
  @HttpCode(201)
  create(@Param("id") id: string) {
    return this.keys.create(id);
  }

  @Delete("streamer-key")
  @Roles("admin")
  @HttpCode(204)
  revoke(@Param("id") id: string) {
    return this.keys.revoke(id);
  }
}
