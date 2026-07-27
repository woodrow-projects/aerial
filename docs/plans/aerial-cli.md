# Plan: `aerial` CLI — provision a station anywhere

> **Status: implemented (M0–M5), pre-first-release.** Built 2026-07-20/24 per this plan; all design
> questions were resolved in the 2026-07-19 grilling session. State model is ADR D16; terminology
> (station/channel) in `CONTEXT.md`. The CLI lives in `packages/cli` (222 Vitest units, D14
> test-first; adversarial multi-agent review passed — 8 findings fixed, see git history). Still
> ahead of the first release: tag `v0.1.0` on the aerial repo (the pinned ref the CLI installs),
> create the `homebrew-tap` repo + `TAP_PUSH_TOKEN` secret, then tag `cli-v0.1.0`; and the per-
> provider live e2e (`up` → probe → `down` → assert nothing labeled remains) with real tokens.

## Implementation notes (deltas & out-of-plan work, kept minimal)

- **Discovered constraint:** Hetzner's pagination max is `per_page=50` (not 200); DO domains carry
  no nameservers in their API response (constant ns1–3.digitalocean.com, commented in the adapter);
  DO tags forbid dots, so station identity rides on the resource *name* everywhere (plan already
  anticipated this for firewalls).
- **Out-of-plan (required, minimal):** `packages/cli/src/version.ts` (`CLI_VERSION` +
  `PINNED_AERIAL_REF` + tarball URL — the concrete pinning mechanism); `bun` as a workspace
  devDependency (compile step); DNS polling via DNS-over-HTTPS (dns.google) so polls are
  injectable/cache-transparent; registrar hints via rdap.org (best-effort, never blocking);
  GitHub slugs hardcoded: everything lives in the org — releases/tarballs on
  `woodrow-projects/aerial` (repo transferred from the personal account 2026-07-26),
  formulas in `woodrow-projects/homebrew-tap`.
- **install.sh changes beyond the bootstrap (M0):** `ask()` now treats a *set-but-empty* env var as
  provided (the CLI legitimately passes `ACME_EMAIL=""` for no-TLS local installs — previously this
  re-prompted interactively); fresh installs `chmod 600 .env` (D10). The self-bootstrap block
  downloads the pinned tarball and re-execs when run outside a checkout (`AERIAL_REF` /
  `AERIAL_TARBALL_URL` overridable; recursion-guarded).
- **Local-mode caddy fix (found in live e2e, 2026-07-26):** `email {$ACME_EMAIL}` with the
  empty email local mode passes is a Caddyfile parse error (crash loop). The directive keyword now
  arrives via compose interpolation (`ACME_EMAIL_DIRECTIVE: ${ACME_EMAIL:+email}`) so the line
  vanishes entirely when no email is set. Known local-mode limitation (unchanged): the layer4
  streamer-ingest ports (8100–8110) terminate TLS with the site certificate, which a `:80` no-TLS
  install doesn't have — live ingest on a local station fails the TLS handshake; panel/Auto-DJ
  paths are unaffected. Revisit if local live-ingest testing becomes a real need.
- **Security hardening from review:** station dir created 0700 (its `.env` holds all secrets);
  DO firewall now attaches before the boot/cloud-init wait (no open-ingress window); a
  provisioning-stage failure gets the same destroy-partial-resources offer as later failures;
  `resolveStation` no longer lets one provider's stale token hide stations at another provider.

## Goal

A user installs one tool (`brew install aerial` or similar) and runs `aerial up`. The CLI installs
Aerial either **on the local machine** or **onto a cloud VM it provisions** (DigitalOcean, Hetzner):
collects a provider API token, provisions the VM, handles DNS for the chosen domain, and runs the
existing installer (`deploy/install.sh`) — so an inexperienced user never touches the cloud
provider's console. The CLI manages **stations** only (one domain → one VM → one Aerial install; see
`CONTEXT.md`) — never channels.

## Decisions so far

### State model (ADR D16)

**The provider is the database.** All created resources are labeled (`managed-by=aerial`,
`aerial-station=<domain>`); the CLI keeps only `~/.config/aerial/` with saved provider tokens and a
station cache. `aerial ls` reconstructs truth from label-filtered provider queries; `aerial down`
deletes the labeled set. No hosted state service, ever (see ADR D16 for rejected alternatives).

### DNS: delegation-first with an in-use-domain guard; guided A-record fallback

Both DigitalOcean and Hetzner manage DNS zones with the **same API token as compute** (Hetzner
merged DNS into the Cloud API; the old `dns.hetzner.com` API was discontinued May 2026), so
provider-hosted zones need no extra credentials.

- **Default path — nameserver delegation.** `aerial up` probes the domain (apex A/AAAA, MX, `www`,
  NS) *and* asks explicitly whether the domain is used for anything else (email, website). If the
  domain is fresh: create the zone at the provider, create the records, print the exact nameserver
  values (deep-linking the registrar's NS help page when the registrar is identifiable via RDAP),
  poll until delegation is live, then proceed. Full DNS automation from then on (future `cdn.`
  CNAME, DNS-01 ACME).
- **Fallback — guided A-record.** If the domain is in use (probe hit or user says so), delegation is
  refused by default: the CLI provisions the VM first, prints the exact A record to add at the
  user's existing DNS host, and polls until it resolves. Zero blast radius on existing
  email/website records (a delegation would silently orphan them — we cannot enumerate a zone over
  AXFR to copy it).
- **User choice.** The guard picks the default, but the user can explicitly choose either path.
- Both paths converge on: DNS resolves → install → Caddy/ACME TLS. TLS cannot be issued before the
  record resolves, so the CLI babysits this ordering.
- There is no zero-manual path (the registrar step is irreducible unless Aerial sells domains);
  delegation makes it once-per-domain, the A-record path is once-per-station.

### Provider scope: launch with Hetzner + DigitalOcean; interface shaped by four

v1 **ships two adapters**: **Hetzner** (default, per ADR D4's egress economics) and
**DigitalOcean**. One provider at launch was rejected because Hetzner's new-account identity
verification can stall or reject signups — an unacceptable first-run dead end with no alternative in
the picker. Build order: Hetzner first internally, DO before launch (the second adapter also proves
the interface isn't Hetzner-shaped).

**3rd/4th candidates (explored, not shipped): Vultr and Linode/Akamai.** Both fit the model — one
account-level token covering compute + DNS + tags, ~$0.01/GB egress overage. Rejected from
consideration: OVH (application-key/consumer-key auth dance is novice-hostile), Contabo (weak API).

**Interface constraints learned from the 4-provider scan:**
- **Tags, not labels.** Hetzner alone has key=value labels with server-side label selectors; DO,
  Vultr, and Linode have flat string tags. The provider interface therefore specifies flat tags
  (`aerial`, `aerial-station:<domain>`) as the common denominator; Hetzner's adapter maps them onto
  labels internally.
- **DNS zones are discovered by name, not tag** (DO domains cannot be tagged): a zone belongs to a
  station iff its name matches the station domain.
- **One token per provider** covers VM + DNS on all four; the interface assumes a single opaque
  token string per provider account.

**Accepted UX floor:** the user visits the provider console exactly once — create an account, mint
one API token (the CLI walks them through it, including Hetzner's project concept and a heads-up
that Hetzner may take a day to verify new accounts). Everything after the token paste is the CLI's
job.

### Language & distribution: TypeScript + Bun-compiled binaries; Homebrew tap + curl installer

The CLI lives in the monorepo as **`packages/cli`**, written in **TypeScript**, compiled to
self-contained per-platform binaries with **`bun build --compile`** (darwin/linux × arm64/x64).
Rationale: one language across the repo, Vitest test-first per ADR D14 applies unchanged, and the
CLI reuses `packages/shared` zod schemas (e.g. validating the same `.env` values the control plane
validates). Go was rejected: better binaries in the abstract, but a permanent second-language tax on
a solo-maintained monorepo, and nothing in this workload (HTTP, prompts, polling) needs it.
Constraint accepted: stick to plain `fetch`/`node:fs`/`node:child_process`, no native/node-gyp deps
(Bun single-file executables are least mature there). Binary size (~50–90 MB) is the accepted wart.

**Distribution — zero infra, all GitHub:**
- Tag `cli-vX.Y.Z` → GitHub Actions cross-compiles, tars, attaches to a **GitHub Release**
  (GitHub hosts all bytes), computes SHA256s, and pushes an updated formula to the
  **Homebrew tap** repo (`woodrow-projects/homebrew-tap` — the org tap can host future
  projects' formulas too): `brew install woodrow-projects/tap/aerial`.
- **`curl … /install | sh`** as the second channel (Linux/no-brew): detects OS/arch, downloads the
  matching release asset.
- `npm i -g` explicitly rejected as a primary channel (requires Node preinstalled — the exact burden
  the CLI removes). homebrew-core is a someday-milestone (needs notability + source builds); the tap
  is the standard on-ramp.

### Install mechanics: hybrid cloud-init + SSH; secrets never touch user-data

- **Invariant: no secrets in cloud-init user-data, ever.** Both DO and Hetzner serve user-data back
  to any process on the box via the metadata endpoint, persistently — a plaintext-password-at-rest
  violation of ADR D10.
- **cloud-init does only the secret-free slow work**: apt update + Docker install
  (`get.docker.com`), running while the CLI walks the user through the DNS step — the two slowest
  steps overlap.
- **SSH does everything secret or interactive.** The CLI generates a per-user ed25519 keypair
  (`ssh-keygen` shell-out → `~/.config/aerial/id_ed25519`), uploads/tags the public key at VM
  create, waits for sshd, then: `curl` the **pinned Aerial release** (each CLI version maps to a
  pinned repo tag — never `main`; a CLI binary only installs combinations tested together) and run
  `deploy/install.sh` **non-interactively** (env vars — it already supports this), streaming output
  live to the user's terminal.
- **Shell out to system `ssh`** (preinstalled on macOS/Linux; avoids a JS SSH lib fighting
  `bun --compile`). Host keys: `accept-new` (TOFU — we connect seconds after the VM exists), stored
  in a per-station `known_hosts` under `~/.config/aerial/`.
- The same key/transport powers day-2 commands (`ssh`/`logs`/`upgrade`) later.
- `install.sh` remains the **single install path** (CLI reuses it, never reimplements it); the
  manual `bash <(curl …)` story keeps working without the CLI. Verify the no-checkout (curl-able)
  path end-to-end; patch `install.sh` if it still assumes a git checkout.

### Local install: CLI owns the prompts; install.sh stays the engine; localhost-only scope

- **The CLI owns all prompts in both modes** (one clack-styled UX); `install.sh` is always invoked
  non-interactively with env vars — locally via direct exec, remotely via SSH. One prompt
  implementation, one install engine.
- **Files land in `~/.local/share/aerial/station/`** (XDG data dir, not user-chosen — ADR D12
  opinionated defaults): the same pinned release tarball the cloud path uses.
- **Docker prerequisite:** Linux → offer to run `get.docker.com` with explicit y/N consent (root
  system change); macOS → detect, explain, link to Docker Desktop/OrbStack, stop until present (no
  silent GUI-app install; acceptable — macOS local is a try-it-out path, not production hosting).
- **Scope cut: local mode = localhost/LAN** (`SITE_ADDRESS=:80`, no TLS/DNS) — the
  kick-the-tires-before-paying path. Home-hosting behind a real domain (port forwarding, dynamic
  DNS) is deliberately **not** automated in v1: the CLI cannot configure routers/ISPs, and a guided
  flow that dies at the router is worse than honesty. Manual path remains possible via install.sh.
- **State:** a local station has no provider to reconstruct from (ADR D16 n/a) — it lives in that
  machine's local config + the running compose project. `aerial ls` = provider-discovered stations
  (global) ∪ local stations (machine-bound).

### Command surface: six flat verbs; opinionated size; live price before create

v1 commands (flat verbs — station is the CLI's only noun): **`up`**, **`ls`** (label-query
providers + local stations, basic HTTPS health probe), **`down <domain>`**, **`ssh <domain>`**,
**`logs <domain>`** (compose logs -f over SSH), **`upgrade <domain>`** (fetch the CLI's pinned
newer release, re-run install over the existing volume — adoption + additive migrations make this
cheap; a provisioning CLI with no update story orphans every station it created).

`up` details: **live price shown before the create call** (DO `price_monthly`, Hetzner pricing
API) — "Hetzner CPX11, €4.99/mo + egress, Falkenstein — proceed?". **VM size is an opinionated
default** (smallest tier with 2 GB RAM), `--size` flag as escape hatch, no size menu (ADR D12).

**Deferred:** `aerial backup` / `aerial up --restore` (v1.1 fast-follow — see below); token
management commands (tokens saved during `up`; removal = delete a file, CLI prints where);
`resize`/multi-region/floating IPs (hosted-tier energy); non-interactive `up` flags (interactive
first; flags when someone actually needs them).

### Backlog (queued behind the full e2e pass)

- **DNS guard: registrar-locked domains (found live, 2026-07-27).** The in-use guard cannot catch
  domains whose *registrar* forbids external nameservers — Cloudflare Registrar being the big one
  (`asiatic.black` e2e: delegation chosen, NS change impossible at Cloudflare, user cancelled
  mid-poll; recovery = `aerial down` + re-`up` with a-record, which worked as designed).
  Fix in `chooseDnsMode`: the CLI already fetches RDAP for the registrar hint — when the registrar
  is Cloudflare (and any other known NS-locked registrars), steer to the A-record path up front
  with a one-line explanation instead of recommending delegation. While in there: when the DNS
  host is Cloudflare, the A-record instruction should say to use **"DNS only" (grey cloud), not
  Proxied** — proxied records break the IP poll, ACME issuance, and the ADR D4 streaming-ToS
  caveat.

### Fast-follow (v1.1): backup / restore

The SQLite story (ADR D11: "copy one file, resurrect the station anywhere") becomes CLI-real:
`aerial backup <domain>` = `sqlite3 .backup` on the VM (never a raw `cp` of a hot WAL file — the
artifact must be one consistent file, no `-wal`/`-shm` sidecars), scp it down.
`aerial up --restore <file>` = provision as usual, scp the backup up, inject before first start.
Requires two small `install.sh` additions (its DB-adoption behavior already exists — startup
`migrate deploy` is additive):
1. `AERIAL_RESTORE_DB=/path` — copy the file into the `aerial_data` volume before first
   `compose up` (one-off `docker run -v aerial_data:… alpine cp`).
2. **Restore mode skips the first-admin prompt/seed** — the restored DB brings its accounts, and
   the self-locking sign-up gate would (correctly) refuse a new first admin. Fresh-vs-restore can
   no longer key off `.env` existence alone.
Regenerated `.env` secrets on the new box are fine: sessions die, engine passwords re-issue, stream
keys live bcrypt-hashed in the DB; media is external (S3-compatible).

### Teardown: destroy what is discovered, confirm by typing the domain, snapshot first

- **`down <domain>` deletes what it discovers, not what it remembers**: it runs the same label
  query as `ls` (VM, firewall; DNS zone by name) and prints the concrete resource list *and* a
  data-loss warning (accounts, channels, stream keys, history) before touching anything.
  Consequence: a half-failed `up` is cleaned by the same code path — `up`'s failure handler offers
  to run `down`, which is idempotent over partial resource sets. No separate cleanup logic.
- **Confirmation = type the full domain** (GitHub-repo-delete style). **No `--force` in v1** —
  scripted teardown is nobody's v1 use case; it's the flag that turns a typo into a catastrophe.
- **Last-chance snapshot (default Y):** "Download a copy of the station database first? [Y/n]" —
  `compose down` on the VM (stops all writers → raw copy is safe; no sqlite3 binary needed), scp
  the DB to `~/aerial-backups/<domain>-<date>.db`, then destroy. ~30 lines on the existing SSH
  transport; also the foundation `aerial backup` (v1.1) builds on.
- **DNS loose ends, stated honestly:** delegation mode → zone deleted; "the domain now points at
  nothing — revert nameservers at your registrar to reuse it." A-record mode → "remove the A record
  at your registrar (it points at a dead IP)"; we can't delete what we don't control.
- **SSH key** is per-user and shared across a provider's stations — deleted only when the last
  `aerial`-tagged resource at that provider goes.
- **Local stations:** same typed confirmation; snapshot offer (local file copy); then
  `compose down -v` + remove the data dir.

## Implementation order

Milestones are sequential; each is shippable/verifiable on its own. TDD per ADR D14 throughout:
test-first Vitest units next to the code in `packages/cli`, all collaborators (provider HTTP,
`ssh`/`ssh-keygen`/`docker` shell-outs, fs, prompts) mocked.

1. **M0 — install.sh groundwork.** Verify the no-checkout path end-to-end (curl/tarball install
   onto a bare VM by hand); patch `install.sh` if it assumes a git checkout. Blocking discovery
   work for everything after.
2. **M1 — CLI skeleton + local mode.** `packages/cli` scaffold; bun-compile build; clack prompt
   layer; `~/.config/aerial/` config store; release-tarball fetch pinned to the repo tag; Docker
   detect/offer-install; local `up` driving `install.sh` non-interactively; local `ls`/`down`.
   Shippable as "try Aerial in one command."
3. **M2 — provider interface + Hetzner + cloud `up`.** Interface types shaped by the 4-provider
   scan (flat tags, zone-by-name, one opaque token); Hetzner adapter (VM/DNS/firewall,
   labels-from-tags mapping); cloud-init (Docker only); ssh-keygen/ssh transport; DNS
   delegation-with-guard + A-record paths with live polling; price display; end-to-end cloud `up`.
4. **M3 — day-2 verbs.** `ls` (label queries + health probe), `down` (discovery-driven, typed
   confirmation, snapshot), `ssh`, `logs`, `upgrade`.
5. **M4 — DigitalOcean adapter.** Second implementation of the interface (the proof it isn't
   Hetzner-shaped). Launch gate: both adapters green.
6. **M5 — release pipeline.** GitHub Actions cross-compile → GitHub Release → tap formula push;
   `curl | sh` installer; version-pinning map (CLI tag → aerial release tag).

**Live-API verification (not unit-testable):** a scripted end-to-end per provider — real token,
real throwaway domain, `up` → probe HTTPS/HLS → `down` → assert zero labeled resources remain —
run manually before each release (CI later). Unit suites never call real provider APIs (D14).

## Out of scope (explicit)

Channel-level anything (control panel's job); hosted state/accounts (ADR D16); home-hosting
automation behind consumer routers; Windows binaries; Vultr/Linode adapters (interface-shaped,
not shipped); homebrew-core; non-interactive `up` flags; `resize`/multi-region.
