import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/**
 * User & role administration (ADR D18). PrismaService is available globally
 * (PrismaModule is @Global). Exported so other modules can reuse the summary
 * projection if needed; the orchestrator wires this module into the app.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
