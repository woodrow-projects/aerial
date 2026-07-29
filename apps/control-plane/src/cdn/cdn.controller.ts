import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from "@nestjs/common";
import { cdnKeySchema, type CdnKeyInput } from "@aerial/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles, RolesGuard } from "../auth/roles";
import { CdnService } from "./cdn.service";

/**
 * Operator-authed CDN controls (the global AuthGuard applies — no @Public()).
 * The one-toggle flow: PUT the key once, then POST enable/disable. Every mutation
 * changes install-wide delivery (and handles the CDN API key), so all three are
 * admin-only (ADR D18: a streamer's panel is read-only), enforced by RolesGuard
 * reading the @Roles metadata below. The status read stays open to any session.
 */
@Controller("api/cdn")
@UseGuards(RolesGuard)
export class CdnController {
  constructor(private readonly cdn: CdnService) {}

  @Get()
  status() {
    return this.cdn.getStatus();
  }

  @Put("key")
  @Roles("admin")
  setKey(@Body(new ZodValidationPipe(cdnKeySchema)) body: CdnKeyInput) {
    return this.cdn.setKey(body.apiKey);
  }

  @Post("enable")
  @Roles("admin")
  @HttpCode(202)
  enable() {
    return this.cdn.enable();
  }

  @Post("disable")
  @Roles("admin")
  @HttpCode(200)
  disable() {
    return this.cdn.disable();
  }
}
