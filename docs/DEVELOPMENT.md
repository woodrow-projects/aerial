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
   user = `source`, password = the stream key, format = MP3/OGG. Connect.
3. The channel badge flips to **● LIVE**; the fallback loop crossfades to your input.
4. Play the **HLS** URL (`/hls/<slug>/live.m3u8`) in Safari/Chrome and the **Icecast**
   URL in VLC. Fetch **`/hls/<slug>/nowplaying.json`** and watch it update.

## Validated end-to-end ✅

The full audio pipeline has been run against the real engine (Liquidsoap **2.2.5**,
Icecast 2.4) via `docker compose up`:

- Channel create → engine spawns one Liquidsoap process → adaptive **HLS** (HE-AAC 64k
  + AAC-LC 128k via `%ffmpeg`) **and** an **Icecast** MP3 mount, both served through Caddy.
- **DJ ingest** (Icecast source protocol) → bcrypt **stream-key auth** gates it →
  `fallback()` **crossfades** loop→live (`live:true`); disconnect crossfades back
  (`live:false`). A wrong key is rejected (TCP dropped).
- `nowplaying.json` is written + served cacheable; the SPA and `/api/docs` are served via Caddy.

Fixes made during validation (now in the code): Liquidsoap `auth` takes a record;
metadata uses `m["title"]` (no `??`); HLS needs `temp_dir`; both Liquidsoap
(`settings.init.allow_root`) and Icecast (`changeowner`) need root handling in
containers; Icecast logs to files + `tail -F` (can't reopen stdout post-drop); the
control-plane image is pinned to the `savonet/liquidsoap:v2.2.5` base + Node, with the
base `liquidsoap` entrypoint reset.

## Remaining caveats (before production)

- **DJ-ingest TLS**: harbor ports are exposed as plain TCP. Putting the Icecast *source*
  protocol behind TLS is a hardening follow-up (D10).
- Schema is applied with `prisma db push` (no migration history yet); switch to
  `migrate deploy` once you cut the first migration.
- Liquidsoap runs as **root** inside the container (`allow_root`); fine in a container,
  but running the control-plane as a non-root user is a later hardening step.
- Engine restart is a fixed 3s retry with no backoff cap — a permanently-broken config
  would respawn indefinitely; add backoff/alerting before relying on it unattended.
