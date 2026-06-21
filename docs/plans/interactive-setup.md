# Plan: Interactive first-run setup (create the first admin)

> **Status: planned.** Replace the manual, error-prone `seed:operator` dance with an interactive first-run
> that creates the first **admin** user. Today setup is three manual steps and easy to get wrong.

## Today (the friction)

`deploy/install.sh` scaffolds `.env`, generates secrets, and runs `docker compose up -d` — then **stops**.
The operator must separately run `docker compose exec … control-plane pnpm seed:operator` with
`OPERATOR_EMAIL`/`OPERATOR_PASSWORD` env vars (see `apps/control-plane/src/auth/seed-operator.ts`), then set
`AUTH_DISABLE_SIGNUP=true` and redeploy to lock public registration. Three steps, manual env juggling, and a
window where signup is open.

## Direction

One guided flow that ends with a working admin login and signup locked. Approaches to weigh:

- **First-run web wizard (explore first).** When the `user` table is empty, the SPA shows a one-time "create
  the first admin" screen; on submit it creates the admin and flips the system into signup-closed
  automatically — no `AUTH_DISABLE_SIGNUP` toggle dance, no shell `exec`. Pairs with the role model
  (admin/streamer — see [`auto-dj-and-scheduling.md`](./auto-dj-and-scheduling.md)).
- **`install.sh` CLI prompt.** The installer prompts for admin name/email/password and seeds before/right
  after `up`, then sets `AUTH_DISABLE_SIGNUP=true`.

## Anchors

- `deploy/install.sh`, `apps/control-plane/src/auth/seed-operator.ts`, `auth.ts` (`disableSignUp`),
  `config/env.ts` (`AUTH_DISABLE_SIGNUP`).

Cross-ref: ADR D13 (operator auth via better-auth); role model in
[`auto-dj-and-scheduling.md`](./auto-dj-and-scheduling.md).
