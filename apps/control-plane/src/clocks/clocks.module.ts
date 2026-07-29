import { Module } from "@nestjs/common";
import { ClocksController } from "./clocks.controller";
import { ClocksService } from "./clocks.service";

@Module({
  controllers: [ClocksController],
  providers: [ClocksService],
  exports: [ClocksService],
})
export class ClocksModule {}
