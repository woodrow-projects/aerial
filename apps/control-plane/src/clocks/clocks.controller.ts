import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { createClockSchema, type CreateClockInput } from "@aerial/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/roles";
import { ClocksService } from "./clocks.service";
import { updateClockSchema, type UpdateClockInput } from "./clocks.schema";

/**
 * Clockwheel CRUD (plan Phase B). Reads are open to any signed-in operator (the
 * SPA clockwheel editor reads GET :id for slots + playlist names); mutations are
 * admin-only (@Roles). Create/update replace the full slot array atomically —
 * validation lives in the shared/local zod schemas + the service.
 */
@Controller("api/clocks")
export class ClocksController {
  constructor(private readonly clocks: ClocksService) {}

  @Get()
  list() {
    return this.clocks.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.clocks.get(id);
  }

  @Post()
  @Roles("admin")
  create(@Body(new ZodValidationPipe(createClockSchema)) body: CreateClockInput) {
    return this.clocks.create(body);
  }

  @Patch(":id")
  @Roles("admin")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClockSchema)) body: UpdateClockInput,
  ) {
    return this.clocks.update(id, body);
  }

  @Delete(":id")
  @Roles("admin")
  @HttpCode(204)
  remove(@Param("id") id: string) {
    return this.clocks.remove(id);
  }
}
