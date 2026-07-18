# Plan: Interactive first-run setup (create the first admin)

> **Status: implemented (CLI path).** `./deploy/install.sh` is now an interactive, single-command first-run
> that scaffolds `.env` with strong secrets, prompts for the domain/email and the first **admin**, brings the
> stack up, and creates that admin. Sign-up is **self-locking**, so the old `AUTH_DISABLE_SIGNUP` flip +
> redeploy dance (and its open-registration window) is gone.

## What shipped

- **One interactive run.** `install.sh` shows the Aerial banner, checks Docker, then asks (via `/dev/tty`, so
  it works under `bash <(curl …)`): site address, ACME email, public base URL, and the first
  admin (name/email/password, confirmed, min 8 chars). All answers can be supplied as env vars for
  unattended/CI runs.
- **Zero database setup.** State is a single SQLite file on the `data` volume (`DATABASE_URL=file:/srv/data/aerial.db`
  — ADR D11, amended 2026-07-17; the original managed/external-Postgres flow was removed with it).
  `migrate deploy` is additive, so re-installing over an existing volume safely **adopts** the existing DB.
- **No forced wipes.** A wipe is only ever an explicit opt-in (`AERIAL_WIPE_EXISTING=1`), never
  required to recover.
- **All secrets generated.** Previously `install.sh` left `BETTER_AUTH_SECRET` and `INTERNAL_API_TOKEN` as
  placeholders (insecure-by-default); the installer now generates both alongside the DB/Icecast/`APP_SECRET`.
- **Self-locking sign-up.** A better-auth `databaseHooks.user.create.before` gate
  (`apps/control-plane/src/auth/first-run.ts`) makes the first account (empty `user` table) the **admin** and
  returns `403` for any later sign-up — across email *and* social. The lock is DB-state-driven, not env-driven.
- **First-admin seed.** `seed-operator.ts` was refactored to a testable `seedOperator(input, deps)` with
  `created | exists | invalid | error` outcomes (idempotent: a re-run reports `exists`). The installer invokes
  it server-side via `docker compose exec … node dist/auth/seed-operator.js` — no public sign-up window.
- **Role column.** `User.role` (`admin | streamer`, default `streamer`) added (migration
  `20260621000000_add_user_role`). Guard-level RBAC enforcement is **not** part of this work — it lands with
  Auto-DJ/scheduling (see [`auto-dj-and-scheduling.md`](./auto-dj-and-scheduling.md)).

## Why CLI, not the web wizard

This plan originally flagged the **web wizard** as "explore first". We chose the **`install.sh` CLI prompt**
instead because the operator's entry point is already a terminal (`install.sh`), so the first admin can be
created in the same one-command flow with no extra page, no "is the user table empty?" public endpoint, and no
post-signup session-refresh edge case in the SPA. The self-locking gate gives the wizard's main benefit
(no toggle dance, no open window) regardless of how the admin is created. A web wizard remains possible later
as an *alternative* entry point — it would reuse the same `firstRunCreateGate` — but is not needed now.

## Anchors

- `deploy/install.sh` (interactive installer), `apps/control-plane/src/auth/first-run.ts` (the gate),
  `apps/control-plane/src/auth/seed-operator.ts` (seeder), `auth.ts` (`databaseHooks` + `user.additionalFields`),
  `config/env.ts` (`AUTH_DISABLE_SIGNUP`, now an optional override).

Cross-ref: ADR D13 (operator auth via better-auth); role model in
[`auto-dj-and-scheduling.md`](./auto-dj-and-scheduling.md).
