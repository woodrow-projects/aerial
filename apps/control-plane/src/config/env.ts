/**
 * Typed, defaulted access to environment configuration. Kept as a plain module
 * (not a Nest provider) so it is trivially importable from the engine templates
 * and unit tests. .env is loaded by ConfigModule in app.module.ts.
 */
function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  port: int(process.env.CONTROL_PLANE_PORT, 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),

  databaseUrl: process.env.DATABASE_URL ?? "",

  // Secret for at-rest encryption of provider credentials (e.g. the CDN API key).
  // >=32 chars; `openssl rand -base64 32`. Distinct from BETTER_AUTH_SECRET.
  appSecret: process.env.APP_SECRET ?? "",

  internal: {
    apiUrl: (process.env.INTERNAL_API_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    token: process.env.INTERNAL_API_TOKEN ?? "",
  },

  icecast: {
    host: process.env.ICECAST_HOST ?? "icecast",
    port: int(process.env.ICECAST_PORT, 8000),
    sourcePassword: process.env.ICECAST_SOURCE_PASSWORD ?? "",
  },

  engine: {
    liquidsoapBin: process.env.LIQUIDSOAP_BIN ?? "liquidsoap",
    hlsRoot: process.env.HLS_ROOT ?? "/srv/hls",
    mediaRoot: process.env.MEDIA_ROOT ?? "/srv/media",
    harborBasePort: int(process.env.HARBOR_BASE_PORT, 8100),
    // Where generated .liq scripts are written
    configRoot: process.env.LIQUIDSOAP_CONFIG_ROOT ?? "/tmp/aerial-liq",
  },

  // Schedule-aware streamer auth (ADR D18).
  schedule: {
    // Minutes of grace around a live show window in which its owner may still connect.
    graceMin: int(process.env.SCHEDULE_GRACE_MIN, 5),
  },

  // Auto-DJ media library (ADR D17); files live under engine.mediaRoot.
  media: {
    // Max upload size per media file, in megabytes.
    uploadMaxMb: int(process.env.UPLOAD_MAX_MB, 200),
  },

  auth: {
    // >=32 chars; `openssl rand -base64 32`. Missing => sessions silently break.
    secret: process.env.BETTER_AUTH_SECRET ?? "",
    // Lock public registration once the first operator(s) exist.
    disableSignUp: process.env.AUTH_DISABLE_SIGNUP === "true",
    // The browser sends the Vite dev origin even through the proxy; better-auth's
    // CSRF/Origin check rejects POSTs from origins not listed here.
    trustedOrigins:
      process.env.AUTH_TRUSTED_ORIGINS?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? (process.env.NODE_ENV === "production" ? [] : ["http://localhost:5173"]),
  },

  webDist: process.env.WEB_DIST ?? "/app/web",
} as const;

export type Env = typeof env;
