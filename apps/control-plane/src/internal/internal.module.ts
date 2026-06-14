import { Module } from "@nestjs/common";
import { ChannelsModule } from "../channels/channels.module";
import { NowPlayingModule } from "../nowplaying/nowplaying.module";
import { InternalController } from "./internal.controller";

@Module({
  imports: [ChannelsModule, NowPlayingModule],
  controllers: [InternalController],
})
export class InternalModule {}
