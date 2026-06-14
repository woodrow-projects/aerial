import { existsSync } from "node:fs";
import { Module, type DynamicModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ServeStaticModule } from "@nestjs/serve-static";
import { env } from "./config/env";
import { PrismaModule } from "./prisma/prisma.module";
import { EngineModule } from "./engine/engine.module";
import { NowPlayingModule } from "./nowplaying/nowplaying.module";
import { ChannelsModule } from "./channels/channels.module";
import { InternalModule } from "./internal/internal.module";

// Serve the built SPA only when present (baked into the image in prod; absent in
// dev, where Vite serves it on :5173). NOTE: verify the `exclude` patterns work
// under the Fastify adapter for your @nestjs/serve-static version.
const staticImports: DynamicModule[] = existsSync(env.webDist)
  ? [
      ServeStaticModule.forRoot({
        rootPath: env.webDist,
        exclude: ["/api/(.*)", "/internal/(.*)"],
      }),
    ]
  : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ...staticImports,
    PrismaModule,
    EngineModule,
    NowPlayingModule,
    ChannelsModule,
    InternalModule,
  ],
})
export class AppModule {}
