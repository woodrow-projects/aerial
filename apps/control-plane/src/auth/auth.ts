import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { buildSocialProviders } from "./social-providers";

/**
 * The better-auth instance (operator auth — ADR: chosen over OpenAuth for an
 * in-app, Postgres-native fit with room for a few accounts + social/SSO).
 *
 * Module-level singleton: read by `@better-auth/cli generate`, the seed script,
 * the Fastify mount in main.ts, and the AuthGuard. It uses its own small Prisma
 * pool — acceptable for a single-operator box; wrap in a Nest provider sharing
 * PrismaService if you want one pool.
 *
 * Requires Node >= 20.19 / 22+ (require(ESM)); the container runs Node 26.
 */
const prisma = new PrismaClient();

export const auth = betterAuth({
  basePath: "/api/auth",
  baseURL: env.publicBaseUrl,
  secret: env.auth.secret,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, disableSignUp: env.auth.disableSignUp },
  socialProviders: buildSocialProviders(),
  trustedOrigins: [...env.auth.trustedOrigins],
  advanced: {
    // Caddy terminates TLS; the container sees plain http. Force Secure cookies
    // only in production (setting it in dev breaks login over http://localhost).
    useSecureCookies: process.env.NODE_ENV === "production",
  },
});

export type Auth = typeof auth;
