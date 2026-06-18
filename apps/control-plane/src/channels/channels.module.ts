import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/engine.module";
import { NowPlayingModule } from "../nowplaying/nowplaying.module";
import { CdnModule } from "../cdn/cdn.module";
import { ChannelsController } from "./channels.controller";
import { ChannelsService } from "./channels.service";
import { StreamKeysService } from "./stream-keys.service";

@Module({
  imports: [EngineModule, NowPlayingModule, CdnModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, StreamKeysService],
  exports: [ChannelsService, StreamKeysService],
})
export class ChannelsModule {}
