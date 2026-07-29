import { Module } from "@nestjs/common";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";

/**
 * Media library module (plan Phase A / ADR D17). PrismaService comes from the global
 * PrismaModule. @fastify/multipart is registered in main.ts (not here) since plugin
 * registration is process-level, not a Nest provider.
 */
@Module({
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
