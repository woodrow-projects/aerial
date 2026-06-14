import { Module } from "@nestjs/common";
import { NowPlayingService } from "./nowplaying.service";

@Module({
  providers: [NowPlayingService],
  exports: [NowPlayingService],
})
export class NowPlayingModule {}
