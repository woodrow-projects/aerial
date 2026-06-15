# Development

Monorepo: **pnpm workspaces + Turborepo**. Packages:

- `apps/control-plane` — NestJS (Fastify) API + engine supervisor (Prisma/Postgres)
- `apps/web` — React + Vite SPA (operator control panel)
- `packages/shared` — zod contracts + types shared by both
- `engine/icecast` — Icecast image; `engine/liquidsoap` — generated-config notes
- `deploy/` — Docker Compose, Caddy, installer

## Prerequisites

- Node 20 (`nvm use`), pnpm via Corepack (`corepack enable`)
- Docker + Docker Compose v2
- For running the **engine** outside Docker: `liquidsoap` (2.2.x) + `ffmpeg` on PATH

## Quick start (Docker — the supported path)

```bash
cp .env.example .env
# set SITE_ADDRESS, ACME_EMAIL, PUBLIC_BASE_URL; install.sh generates secrets
./deploy/install.sh            # first run scaffolds .env, then re-run to launch
# or directly:
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

Open the control panel at `https://$SITE_ADDRESS` (or `http://localhost` with
`SITE_ADDRESS=:80`). API docs at `/api/docs`.

## Local dev (fast iteration, app outside Docker)

```bash
pnpm install
pnpm --filter @aerial/shared build          # other packages import its dist

# bring up just Postgres + Icecast
docker compose -f deploy/docker-compose.yml up -d postgres icecast

# point the API at them (export or use a root .env loaded into your shell)
export DATABASE_URL=postgresql://aerial:<pw>@localhost:5432/aerial?schema=public
export INTERNAL_API_TOKEN=dev-token ICECAST_SOURCE_PASSWORD=<pw>
export PUBLIC_BASE_URL=http://localhost:5173 HLS_ROOT=./.data/hls MEDIA_ROOT=./.data/media

pnpm --filter @aerial/control-plane exec prisma generate
pnpm --filter @aerial/control-plane exec prisma db push
pnpm --filter @aerial/control-plane dev      # :3000  (needs liquidsoap on PATH to spawn engines)
pnpm --filter @aerial/web dev                # :5173  (proxies /api → :3000)
```

> Without `liquidsoap` installed locally the API and SPA still run and channel
> CRUD works; only the spawned audio engine will fail to start. Use the Docker
> path to exercise the full pipeline.

## Verifying the vertical slice

1. Create a channel in the SPA; copy its **DJ ingest** host/port/mount and create a **stream key**.
2. In BUTT/Mixxx: server = ingest host, port = ingest port, mount = `/<slug>`,
   user = `source`, password = the stream key, format = MP3/OGG, **TLS/SSL = on**
   (ingest is TLS-terminated at Caddy — D10). Connect.
3. The channel badge flips to **● LIVE**; the fallback loop crossfades to your input.
4. Play the **HLS** URL (`/hls/<slug>/live.m3u8`) in Safari/Chrome and the **Icecast**
   URL in VLC. Fetch **`/hls/<slug>/nowplaying.json`** and watch it update.

## Operator auth (better-auth)

The `/api/*` surface requires an operator session (ADR D13). Setup:

1. Set `BETTER_AUTH_SECRET` (>=32 chars: `openssl rand -base64 32`) in `.env`.
2. Bring the stack up, then **seed the first operator** while signup is open:
   ```bash
   docker compose -f deploy/docker-compose.yml exec \
     -e OPERATOR_EMAIL=you@example.com -e OPERATOR_PASSWORD='strong-pw' \
     control-plane pnpm seed:operator
   ```
   (or just sign up once via the login page).
3. Set `AUTH_DISABLE_SIGNUP=true` and redeploy to lock public registration.
4. **Social login** (optional): set `GOOGLE_CLIENT_ID/SECRET` and/or `GITHUB_CLIENT_ID/SECRET`, register the
   redirect URI `<PUBLIC_BASE_URL>/api/auth/callback/<provider>`, and rebuild the SPA with
   `VITE_GOOGLE_ENABLED=1` / `VITE_GITHUB_ENABLED=1` to show the buttons.

> Requires the control-plane image's Node 26 (better-auth is ESM-only → needs `require(ESM)`). Local dev over
> `http://localhost` works because `useSecureCookies` is gated on `NODE_ENV==='production'`; the Vite-dev
> proxy origin (`http://localhost:5173`) is in `trustedOrigins` by default.

## Validated end-to-end ✅

The full audio pipeline has been run against the real engine (Liquidsoap **2.2.5**,
Icecast 2.4) via `docker compose up`:

- Channel create → engine spawns one Liquidsoap process → adaptive **HLS** (HE-AAC 64k
  + AAC-LC 128k via `%ffmpeg`) **and** an **Icecast** MP3 mount, both served through Caddy.
- **DJ ingest** (Icecast source protocol) → bcrypt **stream-key auth** gates it →
  `fallback()` **crossfades** loop→live (`live:true`); disconnect crossfades back
  (`live:false`). A wrong key is rejected (TCP dropped).
- **DJ-ingest TLS** (D10): Caddy (custom image with the `caddy-l4` plugin) terminates
  TLS on the ingest ports (8100–8110) reusing its managed cert, and proxies the
  decrypted source to the internal harbor. Verified: a TLS source authenticates and
  goes live; a **plaintext** source to the public port is dropped; harbor ports are
  no longer publicly reachable.
- `nowplaying.json` is written + served cacheable; the SPA and `/api/docs` are served via Caddy.
- **Hardening** (all validated under the full stack): the control-plane container runs as the
  **non-root** `liquidsoap` user (uid 10000); the DB schema is applied via **`prisma migrate
  deploy`** (real migration history) on start; and the engine supervisor restarts crashed
  Liquidsoap processes with **exponential backoff** (3s → cap 60s, reset after a healthy run).

Fixes made during validation (now in the code): Liquidsoap `auth` takes a record;
metadata uses `m["title"]` (no `??`); HLS needs `temp_dir`; both Liquidsoap
(`settings.init.allow_root`) and Icecast (`changeowner`) need root handling in
containers; Icecast logs to files + `tail -F` (can't reopen stdout post-drop); the
control-plane image is pinned to the `savonet/liquidsoap:v2.2.5` base + Node, with the
base `liquidsoap` entrypoint reset.

## Remaining caveats (before production)

- **Ingest source IP**: because Caddy terminates ingest TLS at layer 4, the harbor sees
  Caddy's IP, not the DJ's, so `StreamSession.sourceIp` logs Caddy. Preserving the real
  IP needs PROXY-protocol support on both ends (caddy-l4 `proxy_protocol` + a harbor that
  parses it) — a later enhancement.
- **Local-dev ingest TLS** needs a cert: run with `SITE_ADDRESS=localhost` (Caddy internal
  CA) or a real domain. With `SITE_ADDRESS=:80` the panel works but ingest TLS won't.
- **Non-root volumes**: the control-plane runs as the non-root `liquidsoap` user (uid 10000),
  so the `hls`/`media` volumes must be owned by it. Fresh volumes inherit this automatically;
  volumes created under an older root setup must be `chown`ed or recreated.
