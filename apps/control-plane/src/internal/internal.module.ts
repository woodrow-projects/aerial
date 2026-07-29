import { Module } from "@nestjs/common";
import { AutodjModule } from "../autodj/autodj.module";
import { NowPlayingModule } from "../nowplaying/nowplaying.module";
import { SessionsModule } from "../sessions/sessions.module";
import { StreamerKeysModule } from "../streamer-keys/streamer-keys.module";
import { InternalController } from "./internal.controller";

@Module({
  imports: [NowPlayingModule, SessionsModule, StreamerKeysModule, AutodjModule],
  controllers: [InternalController],
})
export class InternalModule {}
