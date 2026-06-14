import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
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

  await app.listen({ port: env.port, host: "0.0.0.0" });
  new Logger("bootstrap").log(`Aerial control-plane listening on :${env.port} (docs: /api/docs)`);
}

void bootstrap();
