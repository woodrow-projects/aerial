#!/usr/bin/env bash
# Aerial one-command installer (ADR D1: "ship with ease").
#
# Interactive first-run setup: scaffolds .env with strong secrets, asks for the
# few things only you can answer (domain, the first admin), brings the stack up,
# and creates the first admin. Sign-up self-locks once that admin exists — no
# env flip, no redeploy.
#
# Database: SQLite on the `data` volume (ADR D11, amended) — nothing to
# configure. Backup = copy the database file (see docs/DEVELOPMENT.md).
#
# Usage:  ./deploy/install.sh                (from a checkout)
#   or:   bash <(curl -fsSL <raw-url>/deploy/install.sh)
#
# Non-interactive (CI): export SITE_ADDRESS, ACME_EMAIL, PUBLIC_BASE_URL,
# ADMIN_EMAIL, ADMIN_PASSWORD (+ ADMIN_NAME).
# AERIAL_WIPE_EXISTING=1 removes any previous stack + volumes first.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$REPO_ROOT"

# Under `bash <(curl …)` BASH_SOURCE is a /dev/fd path and REPO_ROOT is not a
# checkout. Detected here; the self-bootstrap runs in the main flow below.
HAVE_REPO_TREE=1
[[ -f deploy/docker-compose.yml && -f .env.example ]] || HAVE_REPO_TREE=0

# ── Output helpers ────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
	C_CYAN=$'\033[1;36m'; C_RED=$'\033[1;31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
	C_CYAN=''; C_RED=''; C_DIM=''; C_OFF=''
fi
say() { printf '%s▸ %s%s\n' "$C_CYAN" "$*" "$C_OFF"; }
die() { printf '%s✗ %s%s\n' "$C_RED" "$*" "$C_OFF" >&2; exit 1; }

banner() {
	printf '%s' "$C_CYAN"
	cat <<'AERIAL_ART'
 ░▒▓██████▓▒░░▒▓████████▓▒░▒▓███████▓▒░░▒▓█▓▒░░▒▓██████▓▒░░▒▓█▓▒░
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░
░▒▓████████▓▒░▒▓██████▓▒░ ░▒▓███████▓▒░░▒▓█▓▒░▒▓████████▓▒░▒▓█▓▒░
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░
░▒▓█▓▒░░▒▓█▓▒░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓████████▓▒░
AERIAL_ART
	printf '%s%s   self-hosted online radio — one-command setup%s\n\n' "$C_OFF" "$C_DIM" "$C_OFF"
}

# ── .env helpers ──────────────────────────────────────────────────────────────
# set_env KEY VALUE — set KEY=VALUE in .env (replace in place, or append if new).
set_env() {
	local key="$1" val="$2" esc
	esc=${val//\\/\\\\}; esc=${esc//&/\\&}; esc=${esc//|/\\|}
	if grep -q "^${key}=" .env; then
		sed -i.bak "s|^${key}=.*|${key}=${esc}|" .env && rm -f .env.bak
	else
		printf '%s=%s\n' "$key" "$val" >> .env
	fi
}

# load_env_var KEY — print the value of KEY from .env (empty if absent).
load_env_var() {
	[[ -f .env ]] || return 0
	grep -E "^$1=" .env | head -1 | cut -d= -f2-
}

# default_base_url SITE_ADDRESS — derive a sensible PUBLIC_BASE_URL.
default_base_url() {
	case "$1" in
		http://*|https://*) printf '%s' "$1" ;;
		:80|"")             printf 'http://localhost' ;;
		localhost|localhost:*|127.0.0.1|127.0.0.1:*) printf 'http://%s' "$1" ;;
		*)                  printf 'https://%s' "$1" ;;
	esac
}

# ── Prompt helpers (read from the terminal even under `bash <(curl …)`) ────────
# ask VAR "Label" "default" — skipped if VAR is already set in the environment.
# Set-but-EMPTY also counts as provided: a non-interactive driver (the aerial
# CLI) legitimately passes ACME_EMAIL="" for a no-TLS local install.
ask() {
	local __var="$1" label="$2" default="${3:-}" reply prompt
	[[ -n "${!__var+x}" ]] && return 0
	if [[ ! -r /dev/tty ]]; then
		[[ -n "$default" ]] && { printf -v "$__var" '%s' "$default"; return 0; }
		die "No terminal for prompts and \$$__var is unset. Set it in the environment and re-run."
	fi
	prompt="$label"; [[ -n "$default" ]] && prompt="$label [$default]"
	printf '%s: ' "$prompt" > /dev/tty
	read -r reply < /dev/tty || true
	[[ -z "$reply" && -n "$default" ]] && reply="$default"
	while [[ -z "$reply" ]]; do
		printf '  Required — %s: ' "$label" > /dev/tty
		read -r reply < /dev/tty || true
	done
	printf -v "$__var" '%s' "$reply"
}

# ask_secret VAR "Label" — silent single read, no length policy (existing creds).
ask_secret() {
	local __var="$1" label="$2" v
	[[ -n "${!__var:-}" ]] && return 0
	[[ -r /dev/tty ]] || die "No terminal for '$label' and \$$__var is unset."
	printf '%s: ' "$label" > /dev/tty
	read -rs v < /dev/tty || true; printf '\n' > /dev/tty
	printf -v "$__var" '%s' "$v"
}

# ask_password VAR — silent, confirmed, min 8 chars (for a NEW account).
ask_password() {
	local __var="$1" preset v1 v2
	preset="${!__var:-}"
	if [[ -n "$preset" ]]; then
		(( ${#preset} >= 8 )) || die "$__var must be at least 8 characters."
		return 0
	fi
	[[ -r /dev/tty ]] || die "No terminal for the admin password and \$$__var is unset."
	while :; do
		printf 'Admin password (min 8 chars): ' > /dev/tty
		read -rs v1 < /dev/tty || true; printf '\n' > /dev/tty
		printf 'Confirm password            : ' > /dev/tty
		read -rs v2 < /dev/tty || true; printf '\n' > /dev/tty
		[[ "$v1" != "$v2" ]] && { printf '  Passwords do not match — try again.\n' > /dev/tty; continue; }
		(( ${#v1} < 8 )) && { printf '  Too short (min 8) — try again.\n' > /dev/tty; continue; }
		printf -v "$__var" '%s' "$v1"; break
	done
}

# ── Compose wrapper ────────────────────────────────────────────────────────────
compose() {
	docker compose -f deploy/docker-compose.yml --env-file .env "$@"
}

# Poll until the control plane accepts connections (its CMD runs
# `prisma migrate deploy` before listening, so a live port ⇒ migrations applied).
wait_for_control_plane() {
	local tries=0 max=60
	printf '%s▸ Waiting for the control plane%s' "$C_CYAN" "$C_OFF"
	while (( tries < max )); do
		if compose exec -T control-plane node -e \
			'require("net").connect(3000,"127.0.0.1").on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))' \
			>/dev/null 2>&1; then
			printf ' ✓\n'; return 0
		fi
		printf '.'; tries=$((tries + 1)); sleep 2
	done
	printf '\n'; return 1
}

wipe_stack_volumes() {
	say "Removing the previous stack and its data volumes…"
	docker compose -f deploy/docker-compose.yml down -v --remove-orphans >/dev/null 2>&1 || true
	# aerial_pgdata is the pre-SQLite Postgres volume — removed here so a wipe
	# also cleans up installs from before the ADR D11 amendment.
	docker volume rm aerial_data aerial_pgdata aerial_hls aerial_media aerial_caddy_data aerial_caddy_config >/dev/null 2>&1 || true
}

# Sourced for tests (AERIAL_INSTALL_LIB=1) → define helpers and stop here.
[[ "${AERIAL_INSTALL_LIB:-}" == "1" ]] && return 0 2>/dev/null || true

# ── Main flow ─────────────────────────────────────────────────────────────────
banner

say "Checking prerequisites…"
command -v docker >/dev/null 2>&1 || die "Docker is required. Install Docker Engine first: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose)."

# SELF-BOOTSTRAP: no repo tree — fetch the pinned release tarball and re-exec
# from it. exec inherits the environment, so non-interactive vars survive.
if (( ! HAVE_REPO_TREE )); then
	if [[ "${AERIAL_BOOTSTRAPPED:-}" == "1" ]]; then
		die "Bootstrapped tree at $REPO_ROOT still lacks deploy/docker-compose.yml or .env.example — refusing to loop. Check AERIAL_REF / AERIAL_TARBALL_URL."
	fi
	command -v curl >/dev/null 2>&1 || die "curl is required to download the Aerial release."
	command -v tar >/dev/null 2>&1 || die "tar is required to unpack the Aerial release."
	# Default must match PINNED_AERIAL_REF in packages/cli/src/version.ts.
	AERIAL_REF="${AERIAL_REF:-v0.1.0}"
	# Override exists for tests/mirrors.
	AERIAL_TARBALL_URL="${AERIAL_TARBALL_URL:-https://codeload.github.com/mattasaminew/aerial/tar.gz/${AERIAL_REF}}"
	if [[ "$EUID" -eq 0 ]]; then
		AERIAL_DIR="/opt/aerial"
	else
		AERIAL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/aerial/station"
	fi
	say "No checkout found — fetching Aerial ${AERIAL_REF} into ${AERIAL_DIR}…"
	mkdir -p "$AERIAL_DIR"
	curl -fsSL "$AERIAL_TARBALL_URL" | tar -xz --strip-components=1 -C "$AERIAL_DIR" \
		|| die "Could not download/extract $AERIAL_TARBALL_URL"
	export AERIAL_BOOTSTRAPPED=1
	exec bash "$AERIAL_DIR/deploy/install.sh"
fi

# Opt-in clean slate (deletes the database — never required, only on request).
if [[ "${AERIAL_WIPE_EXISTING:-}" == "1" ]]; then
	wipe_stack_volumes
	rm -f .env
fi

FRESH=0
[[ -f .env ]] || FRESH=1

if (( FRESH )); then
	command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets."
	say "First run — let's configure this install."
	cp .env.example .env
	chmod 600 .env  # holds every secret this install generates (D10)

	# 1) Database: SQLite on the `data` volume — nothing to ask.
	set_env DATABASE_URL "file:/srv/data/aerial.db"

	# 2) Site / TLS.
	ask SITE_ADDRESS "Site address (domain, e.g. radio.example.com; ':80' for no-TLS local)" "radio.example.com"
	ask ACME_EMAIL   "ACME / Let's Encrypt email (for the TLS cert)" ""
	ask PUBLIC_BASE_URL "Public base URL" "$(default_base_url "$SITE_ADDRESS")"
	set_env SITE_ADDRESS "$SITE_ADDRESS"
	set_env ACME_EMAIL "$ACME_EMAIL"
	set_env PUBLIC_BASE_URL "$PUBLIC_BASE_URL"

	# 3) First admin.
	ask ADMIN_EMAIL "First admin — email" ""
	ask ADMIN_NAME  "First admin — display name" "Operator"
	ask_password ADMIN_PASSWORD

	# 4) Remaining secrets (always needed, regardless of DB mode).
	say "Generating secrets…"
	set_env ICECAST_SOURCE_PASSWORD "$(openssl rand -hex 16)"
	set_env ICECAST_ADMIN_PASSWORD "$(openssl rand -hex 16)"
	set_env APP_SECRET "$(openssl rand -hex 32)"
	set_env INTERNAL_API_TOKEN "$(openssl rand -hex 32)"
	set_env BETTER_AUTH_SECRET "$(openssl rand -base64 32 | tr -d '\n')"
	# AUTH_DISABLE_SIGNUP stays false — sign-up self-locks once the admin exists.
else
	say "Using existing .env (secrets unchanged)."
	PUBLIC_BASE_URL="$(load_env_var PUBLIC_BASE_URL)"
fi

say "Building and starting the stack… (the first build can take a few minutes)"
compose up -d --build

if ! wait_for_control_plane; then
	die "Control plane did not become ready. Check logs: docker compose -f deploy/docker-compose.yml logs control-plane"
fi

if (( FRESH )); then
	say "Creating the first admin…"
	if compose exec -T \
		-e OPERATOR_EMAIL="$ADMIN_EMAIL" \
		-e OPERATOR_PASSWORD="$ADMIN_PASSWORD" \
		-e OPERATOR_NAME="$ADMIN_NAME" \
		control-plane node dist/auth/seed-operator.js; then
		:
	else
		printf '%s! Admin creation did not complete. You can still create the first admin by\n' "$C_RED"
		printf '  opening the panel and signing up once (sign-up self-locks afterwards).%s\n' "$C_OFF"
	fi
fi

printf '\n'
say "Done. Open the control panel:"
printf '    %s\n' "${PUBLIC_BASE_URL:-https://$SITE_ADDRESS}"
say "Tail logs:"
printf '    docker compose -f deploy/docker-compose.yml logs -f\n'
