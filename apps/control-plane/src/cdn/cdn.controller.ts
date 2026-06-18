import { Body, Controller, Get, HttpCode, Post, Put } from "@nestjs/common";
import { cdnKeySchema, type CdnKeyInput } from "@aerial/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CdnService } from "./cdn.service";

/**
 * Operator-authed CDN controls (the global AuthGuard applies — no @Public()).
 * The one-toggle flow: PUT the key once, then POST enable/disable.
 */
@Controller("api/cdn")
export class CdnController {
  constructor(private readonly cdn: CdnService) {}

  @Get()
  status() {
    return this.cdn.getStatus();
  }

  @Put("key")
  setKey(@Body(new ZodValidationPipe(cdnKeySchema)) body: CdnKeyInput) {
    return this.cdn.setKey(body.apiKey);
  }

  @Post("enable")
  @HttpCode(202)
  enable() {
    return this.cdn.enable();
  }

  @Post("disable")
  @HttpCode(200)
  disable() {
    return this.cdn.disable();
  }
}
