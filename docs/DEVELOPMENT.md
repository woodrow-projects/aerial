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
- Schema is applied with `prisma db push` (no migration history yet); switch to
  `migrate deploy` once you cut the first migration.
- Liquidsoap runs as **root** inside the container (`allow_root`); fine in a container,
  but running the control-plane as a non-root user is a later hardening step.
- Engine restart is a fixed 3s retry with no backoff cap — a permanently-broken config
  would respawn indefinitely; add backoff/alerting before relying on it unattended.
