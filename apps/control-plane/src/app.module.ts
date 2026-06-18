import { existsSync } from "node:fs";
import { Module, type DynamicModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ServeStaticModule } from "@nestjs/serve-static";
import { AuthGuard } from "./auth/auth.guard";
import { env } from "./config/env";
import { PrismaModule } from "./prisma/prisma.module";
import { EngineModule } from "./engine/engine.module";
import { NowPlayingModule } from "./nowplaying/nowplaying.module";
import { ChannelsModule } from "./channels/channels.module";
import { CdnModule } from "./cdn/cdn.module";
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
    CdnModule,
    InternalModule,
  ],
  // Global operator-session guard; controllers opt out with @Public().
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
