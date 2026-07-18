import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { buildSocialProviders } from "./social-providers";
import { firstRunCreateGate, STREAMER_ROLE } from "./first-run";

/**
 * The better-auth instance (operator auth — ADR: chosen over OpenAuth for an
 * in-app, Prisma-native fit with room for a few accounts + social/SSO).
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
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  emailAndPassword: { enabled: true, disableSignUp: env.auth.disableSignUp },
  socialProviders: buildSocialProviders(),
  // `role` is server-assigned only (input:false) — clients can't set it at
  // sign-up. The first-run hook below promotes the first account to admin.
  user: {
    additionalFields: {
      role: { type: "string", required: false, input: false, defaultValue: STREAMER_ROLE },
    },
  },
  // Self-locking sign-up: first account → admin; any later attempt → 403.
  // Replaces the AUTH_DISABLE_SIGNUP flip + redeploy (no open window).
  databaseHooks: {
    user: {
      create: {
        before: (user) => firstRunCreateGate(user, () => prisma.user.count()),
      },
    },
  },
  trustedOrigins: [...env.auth.trustedOrigins],
  advanced: {
    // Caddy terminates TLS; the container sees plain http. Force Secure cookies
    // only in production (setting it in dev breaks login over http://localhost).
    useSecureCookies: process.env.NODE_ENV === "production",
  },
});

export type Auth = typeof auth;
