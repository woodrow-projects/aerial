#!/usr/bin/env bash
# Aerial one-command installer (ADR D1: "ship with ease").
# Usage:  ./deploy/install.sh        (run from a checkout)
#   or:   curl -fsSL <raw-url>/deploy/install.sh | bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

say "Checking prerequisites…"
command -v docker >/dev/null 2>&1 || die "Docker is required. Install Docker Engine first: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose)."

if [[ ! -f .env ]]; then
	say "Creating .env from .env.example — EDIT IT before going to production."
	cp .env.example .env
	# Generate strong defaults for secrets so a fresh install isn't insecure-by-default.
	if command -v openssl >/dev/null 2>&1; then
		PW_DB="$(openssl rand -hex 16)"
		PW_SRC="$(openssl rand -hex 16)"
		PW_ADM="$(openssl rand -hex 16)"
		APP_SEC="$(openssl rand -hex 32)" # at-rest encryption key for the CDN API key
		sed -i.bak \
			-e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PW_DB}|" \
			-e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://aerial:${PW_DB}@postgres:5432/aerial?schema=public|" \
			-e "s|^ICECAST_SOURCE_PASSWORD=.*|ICECAST_SOURCE_PASSWORD=${PW_SRC}|" \
			-e "s|^ICECAST_ADMIN_PASSWORD=.*|ICECAST_ADMIN_PASSWORD=${PW_ADM}|" \
			-e "s|^APP_SECRET=.*|APP_SECRET=${APP_SEC}|" \
			.env && rm -f .env.bak
		say "Generated random secrets in .env."
	else
		say "openssl not found — using placeholder secrets. CHANGE THEM in .env."
	fi
	say "Set SITE_ADDRESS, ACME_EMAIL and PUBLIC_BASE_URL in .env, then re-run."
	exit 0
fi

say "Building and starting the stack…"
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build

# Database migrations (`prisma migrate deploy`) run automatically on control-plane start.

say "Done. Stack is up (migrations run on control-plane start). Tail logs with:"
echo "    docker compose -f deploy/docker-compose.yml logs -f"
