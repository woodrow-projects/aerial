import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { fromNodeHeaders } from "better-auth/node";
import { AppModule } from "./app.module";
import { auth } from "./auth/auth";
import { env } from "./config/env";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }), // behind Caddy
  );
  app.enableCors({ origin: true });
  app.enableShutdownHooks(); // graceful Liquidsoap drain on SIGTERM (ADR D5)

  const config = new DocumentBuilder()
    .setTitle("Aerial Control Plane")
    .setDescription("API-first, self-hosted online radio control plane")
    .setVersion("0.1.0")
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, config));

  // Mount better-auth's web-standard handler on a raw Fastify catch-all. This is
  // NOT a Nest controller, so the global AuthGuard doesn't run on it. Keep
  // Fastify's default body parsing ON — we re-stringify the parsed body here.
  // Must register before app.listen() (Fastify rejects routes after ready).
  const fastify = app.getHttpAdapter().getInstance();
  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (request, reply) => {
      const url = new URL(request.url, `${request.protocol}://${request.headers.host}`);
      const req = new Request(url, {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        body: request.body ? JSON.stringify(request.body) : undefined,
      });
      const res = await auth.handler(req);
      reply.status(res.status);
      // Forward headers, but Set-Cookie must go as an array (Headers.forEach
      // collapses multiple Set-Cookie into one comma-joined value and corrupts it).
      res.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      });
      const cookies = res.headers.getSetCookie?.() ?? [];
      if (cookies.length) reply.header("set-cookie", cookies);
      reply.send(res.body ? await res.text() : null);
    },
  });

  await app.listen({ port: env.port, host: "0.0.0.0" });
  new Logger("bootstrap").log(`Aerial control-plane listening on :${env.port} (docs: /api/docs)`);
}

void bootstrap();
