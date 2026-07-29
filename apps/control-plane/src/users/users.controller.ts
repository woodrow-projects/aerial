import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles, RolesGuard } from "../auth/roles";
import { UsersService } from "./users.service";
import { updateRoleSchema, type UpdateRoleInput } from "./users.schema";

/**
 * Operator/user administration (ADR D18). The whole surface is admin-only — managing
 * users and roles is not a streamer power, so even the list is @Roles("admin") (unlike
 * the read-any-session library/schedule endpoints).
 */
@Controller("api/users")
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles("admin")
  list() {
    return this.users.list();
  }

  @Patch(":id/role")
  @Roles("admin")
  setRole(@Param("id") id: string, @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleInput) {
    return this.users.setRole(id, body.role);
  }
}
