#!/usr/bin/env bash
# Aerial one-command installer (ADR D1: "ship with ease").
#
# Interactive first-run setup: scaffolds .env with strong secrets, asks for the
# few things only you can answer (database, domain, the first admin), brings the
# stack up, and creates the first admin. Sign-up self-locks once that admin
# exists — no env flip, no redeploy.
#
# Database: choose **managed** (Aerial runs Postgres in Docker for you) or
# **external** (bring your own / a managed Postgres). External never starts a
# Postgres container and never touches your credentials.
#
# Usage:  ./deploy/install.sh                (from a checkout)
#   or:   bash <(curl -fsSL <raw-url>/deploy/install.sh)
#
# Non-interactive (CI): export DB_MODE (managed|external), SITE_ADDRESS,
# ACME_EMAIL, PUBLIC_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD (+ ADMIN_NAME); for
# external also DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/DB_SSLMODE.
# AERIAL_WIPE_EXISTING=1 removes any previous stack + volumes first.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$REPO_ROOT"

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

# urlencode STRING — percent-encode everything outside the URL-unreserved set
# (so a DB password with @ : / ? & etc. survives inside a connection URL).
urlencode() {
	local s="$1" out='' i c
	for (( i = 0; i < ${#s}; i++ )); do
		c="${s:i:1}"
		case "$c" in
			[a-zA-Z0-9.~_-]) out+="$c" ;;
			*) printf -v c '%%%02X' "'$c"; out+="$c" ;;
		esac
	done
	printf '%s' "$out"
}

# build_database_url HOST PORT DB USER PASSWORD [SSLMODE]
build_database_url() {
	local host="$1" port="$2" db="$3" user="$4" pass="$5" sslmode="${6:-}" url
	url="postgresql://$(urlencode "$user"):$(urlencode "$pass")@${host}:${port}/${db}?schema=public"
	[[ -n "$sslmode" ]] && url+="&sslmode=${sslmode}"
	printf '%s' "$url"
}

# ── Prompt helpers (read from the terminal even under `bash <(curl …)`) ────────
# ask VAR "Label" "default" — skipped if VAR is already set in the environment.
ask() {
	local __var="$1" label="$2" default="${3:-}" reply prompt
	[[ -n "${!__var:-}" ]] && return 0
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

# choose_db_mode — set DB_MODE to managed|external (env value respected).
choose_db_mode() {
	if [[ -n "${DB_MODE:-}" ]]; then
		case "$DB_MODE" in managed|external) return 0 ;; *) die "DB_MODE must be 'managed' or 'external'." ;; esac
	fi
	[[ -r /dev/tty ]] || { DB_MODE=managed; return 0; }
	printf '\n%sDatabase%s\n' "$C_CYAN" "$C_OFF" > /dev/tty
	printf '  1) managed  — Aerial runs Postgres in Docker for you (recommended)\n' > /dev/tty
	printf '  2) external — connect to your own / a managed Postgres\n' > /dev/tty
	local reply
	while :; do
		printf 'Choose [1]: ' > /dev/tty
		read -r reply < /dev/tty || true
		case "${reply:-1}" in
			1|managed)  DB_MODE=managed;  break ;;
			2|external) DB_MODE=external; break ;;
			*) printf '  Enter 1 or 2.\n' > /dev/tty ;;
		esac
	done
}

# ── Compose wrapper (managed mode also activates the postgres service) ─────────
compose() {
	local extra=()
	[[ "${DB_MODE:-}" == "managed" ]] && extra=(--profile managed-db)
	docker compose -f deploy/docker-compose.yml --env-file .env "${extra[@]}" "$@"
}

wait_for_postgres() {
	local tries=0 max=30
	printf '%s▸ Waiting for Postgres%s' "$C_CYAN" "$C_OFF"
	while (( tries < max )); do
		if compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
			printf ' ✓\n'; return 0
		fi
		printf '.'; tries=$((tries + 1)); sleep 2
	done
	printf '\n'; return 1
}

# Force the managed role password to equal .env — a no-op on a freshly
# initialised volume, a NON-DESTRUCTIVE repair if an older volume's password
# drifted (Postgres ignores POSTGRES_PASSWORD once its data dir exists). Uses the
# image's local-socket trust auth, so it needs no prior password and loses no data.
reconcile_managed_db_password() {
	if compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
		-c "ALTER USER \"$POSTGRES_USER\" WITH PASSWORD '${POSTGRES_PASSWORD}';" >/dev/null 2>&1; then
		say "Database credentials reconciled."
	else
		say "Note: could not auto-reconcile the database password; continuing."
	fi
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
	docker compose -f deploy/docker-compose.yml --profile managed-db down -v --remove-orphans >/dev/null 2>&1 || true
	docker volume rm aerial_pgdata aerial_hls aerial_media aerial_caddy_data aerial_caddy_config >/dev/null 2>&1 || true
}

# Sourced for tests (AERIAL_INSTALL_LIB=1) → define helpers and stop here.
[[ "${AERIAL_INSTALL_LIB:-}" == "1" ]] && return 0 2>/dev/null || true

# ── Main flow ─────────────────────────────────────────────────────────────────
banner

say "Checking prerequisites…"
command -v docker >/dev/null 2>&1 || die "Docker is required. Install Docker Engine first: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose)."

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

	# 1) Database: managed (we run Postgres) or external (bring your own).
	choose_db_mode
	set_env DB_MODE "$DB_MODE"
	if [[ "$DB_MODE" == "managed" ]]; then
		POSTGRES_USER="aerial"; POSTGRES_DB="aerial"; POSTGRES_PASSWORD="$(openssl rand -hex 16)"
		set_env POSTGRES_USER "$POSTGRES_USER"
		set_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
		set_env POSTGRES_DB "$POSTGRES_DB"
		set_env DATABASE_URL "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
	else
		say "Enter your Postgres connection details:"
		ask DB_HOST "  Host" ""
		ask DB_PORT "  Port" "5432"
		ask DB_NAME "  Database" "aerial"
		ask DB_USER "  User" "aerial"
		ask_secret DB_PASSWORD "  Password"
		ask DB_SSLMODE "  SSL mode (require|prefer|disable)" "require"
		set_env DATABASE_URL "$(build_database_url "$DB_HOST" "$DB_PORT" "$DB_NAME" "$DB_USER" "$DB_PASSWORD" "$DB_SSLMODE")"
	fi

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
	DB_MODE="$(load_env_var DB_MODE)"; DB_MODE="${DB_MODE:-managed}"
	PUBLIC_BASE_URL="$(load_env_var PUBLIC_BASE_URL)"
	if [[ "$DB_MODE" == "managed" ]]; then
		POSTGRES_USER="$(load_env_var POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-aerial}"
		POSTGRES_DB="$(load_env_var POSTGRES_DB)"; POSTGRES_DB="${POSTGRES_DB:-aerial}"
		POSTGRES_PASSWORD="$(load_env_var POSTGRES_PASSWORD)"
	fi
fi

# Managed DB: bring Postgres up first, reconcile its password, then the rest.
if [[ "$DB_MODE" == "managed" ]]; then
	say "Starting Postgres…"
	compose up -d postgres
	wait_for_postgres || die "Postgres did not become healthy. Check: docker compose -f deploy/docker-compose.yml --profile managed-db logs postgres"
	reconcile_managed_db_password
else
	say "Using external Postgres (no container will be started for it)."
fi

say "Building and starting the stack… (the first build can take a few minutes)"
compose up -d --build

if ! wait_for_control_plane; then
	if compose logs control-plane 2>/dev/null | grep -q 'P1000'; then
		if [[ "$DB_MODE" == "external" ]]; then
			die "Database authentication failed (P1000) against your external Postgres. Re-check the host/user/password/SSL mode (DATABASE_URL in .env)."
		fi
		die "Database authentication failed (P1000). For a clean slate: AERIAL_WIPE_EXISTING=1 ./deploy/install.sh"
	fi
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
