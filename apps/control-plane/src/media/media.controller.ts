import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req, UseGuards } from "@nestjs/common";
import type { Readable } from "node:stream";
import { createTrackMetaSchema, type CreateTrackMetaInput } from "@aerial/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles, RolesGuard } from "../auth/roles";
import { MediaService } from "./media.service";

/**
 * The slice of the (@fastify/multipart-augmented) Fastify request the upload route
 * consumes. Typed locally so this module doesn't reach for the transitive `fastify`
 * types — we only ever call `.file()`.
 */
interface MultipartRequest {
  file(): Promise<{ filename: string; file: Readable } | undefined>;
}

/**
 * Media library API (plan Phase A / ADR D17). Reads are open to any signed-in operator;
 * mutations (upload/patch/delete) are admin-only (@Roles). @fastify/multipart is
 * registered in main.ts with the size cap from env.media.uploadMaxMb.
 */
@Controller("api/media")
// RBAC (D18): RolesGuard reads the @Roles metadata below — without it the
// decorators are inert (review finding: streamers could mutate).
@UseGuards(RolesGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list() {
    return this.media.list();
  }

  @Post()
  @Roles("admin")
  async upload(@Req() req: MultipartRequest) {
    const file = await req.file();
    if (!file) throw new BadRequestException("expected a multipart file upload");
    return this.media.create({ originalName: file.filename, stream: file.file });
  }

  @Patch(":id")
  @Roles("admin")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createTrackMetaSchema)) body: CreateTrackMetaInput,
  ) {
    return this.media.update(id, body);
  }

  @Delete(":id")
  @Roles("admin")
  @HttpCode(204)
  remove(@Param("id") id: string) {
    return this.media.remove(id);
  }
}
