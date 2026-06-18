# Aerial — Product Specification (v2)

> **v2 supersedes the original K3s spec.** The original design and the earlier AWS/SST design are preserved
> under [`docs/legacy/`](./docs/legacy). Architecture detail lives in
> [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md); the reasoning behind every choice is in
> [`docs/ADRS.md`](./docs/ADRS.md).

## 1. What Aerial is

A **CDN-native, self-hosted online radio platform** that a person with only basic technical knowledge can
ship *with ease*. One operator installs it on one cheap VM with a single command, creates a handful of
channels, broadcasts live, and shares stream endpoints to embed in their own site. When an audience grows,
delivery scales by flipping on a CDN — no re-platforming, no surprise bill.

It is positioned as a credible, modern alternative to AzuraCast, differentiated by **CDN-native HLS delivery,
one-toggle CDN provisioning, cost transparency, an opinionated modern UX, first-class multi-channel, and an
API-first / bring-your-own-frontend stance.**

**Design principle:** self-host the lightweight brain; rent the bandwidth-bound edge over cacheable HLS,
only when the audience justifies it.

## 2. Target user & guiding goal

- **Operator:** technically literate but not a software developer. Runs *their own* radio (initially for
  themselves), not a multi-tenant hosting business.
- **Guiding goal:** *ship an online radio with ease* — drives every scope and UX decision.
- **Reframing fact:** audio delivery is **bandwidth-bound, not CPU-bound**; persistent Icecast streams are
  uncacheable but **HLS segments are**. This dictates the architecture (see ADR D2/D3).

## 3. Goals & non-goals

**Goals (v1):** one-command self-host on a single VM; 2–5 channels per install (e.g. main + secondary, music
+ talk); live DJ ingest with stream-key auth; HLS + origin-direct Icecast delivery; cacheable now-playing;
auto-TLS; opinionated control panel; listenable with **no CDN required**.

**Explicit non-goals (v1):** Kubernetes/K3s/KEDA; any relay fleet (pods or tasks); AWS-native deployment; a
full/branded listen page; in-browser "Go Live"; Auto-DJ / media library; multi-tenant SaaS; OBS guidance.

## 4. Architecture (summary)

A single **Docker Compose** stack on one flat-bandwidth VM:

- **Caddy** — auto-TLS, reverse proxy, HLS static origin.
- **control-plane** — **NestJS (Fastify adapter)** + the **React/Vite SPA** it serves; channel CRUD, auth,
  stream keys, the engine supervisor, the now-playing pump.
- **Engine** — **one Liquidsoap process per channel** (spawned/supervised by the control plane), each
  emitting an **HLS rendition set** *and* **one Icecast mount**; a single **Icecast** hosts all mounts.
- **Postgres** — state, with nightly off-VM backup.

Delivery has two paths: **HLS** (default, CDN-cacheable, web/mobile, ~16–24s) and **Icecast** (origin-direct,
~2–8s, legacy/interactive/directories). The CDN only ever serves HLS. Full detail in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## 5. Data model (initial)

- `users` — operator accounts (control-panel auth).
- `stations` / `channels` — `id`, `name`, `slug`, `is_active`, codec/bitrate config, fallback source ref.
- `stream_keys` — `id`, `channel_id`, `key_hash` (bcrypt), `is_active`, `created_at`, `last_used_at`.
- `stream_sessions` — per-stream log: channel, mount, start/stop, source IP (abuse/DMCA + analytics).
- `listener_stats` — sampled/aggregated concurrency (origin + later CDN logs / client heartbeat).

Stream keys are **server-generated, high-entropy, hashed, constant-time compared** — never plaintext, never
user-chosen.

## 6. Public surface (v1)

Per channel, Aerial exposes only: the **HLS `.m3u8` URL**, the **Icecast mount URL**, and
**`nowplaying.json`** (cacheable). Operators build their own players/pages. (Optional minimal embeddable
player is deferred.)

## 7. Differentiators (the wedge)

1. **CDN-native, HLS-first delivery out of the box** — survive a hug-of-death without provisioning a server.
2. **One-toggle, auto-provisioned CDN** (pull zone + DNS + TLS + cache headers via API).
3. **Cost-transparency dashboard** — "N listeners → projected $X/mo", spend caps + alerts (early wedge).
4. **Ruthlessly opinionated modern UX/DX** on a zero-Kubernetes single-container runtime.
5. **First-class multi-channel** (shared media + unified now-playing).
6. **API-first / bring-your-own-frontend.**

> Podcasts, deep scheduling, WebDJ, and royalty reports are **table stakes, not differentiators** — they
> must not crowd out the delivery/UX/cost wedge.

## 8. Roadmap

- **v1 (core — live + self-host):** the architecture above; multi-channel live ingest; HLS + Icecast;
  now-playing; auto-TLS; loudness/gapless defaults; **delivery direct from the VM, no CDN**.
- **Fast-follow (Auto-DJ + CDN toggle + cost):** Auto-DJ from S3-compatible storage via the same
  `fallback()` chain; media library + upload; CDN auto-provisioning toggle (Bunny — see
  [`docs/plans/one-toggle-cdn.md`](./docs/plans/one-toggle-cdn.md)); cost-transparency / spend-cap dashboard;
  CDN-aware analytics.
- **Scale + harden:** CDN-over-HLS as the lever; vertical NIC headroom first; optional self-run relay nodes;
  warm-standby origin (HA); optional LL-HLS. *Future:* in-browser WebRTC "Go Live"; PaaS 1-click template; a
  hosted/SaaS tier from the same artifact.

### Backlog (refinements)

- **Per-channel `deliveryMode` (`hls` | `icecast` | `both`)** — controls which `output.*` block the
  config-generator emits per channel. Trivial because HLS and Icecast are independent sibling outputs; pairs
  with the per-channel codec/bitrate already modelled.
- **Pluggable "bring your own CDN"** — any origin-pull HTTP CDN works manually today; ship auto-provision
  adapters Bunny-first, then Gcore/CDN77/Cloudflare. Also support a DIY nginx/Varnish relay-node edge for
  operators who want max control / min bandwidth cost (see ADR D4).

## 9. Defaults & providers

Origin host default **Hetzner** (cheap/flat egress); CDN default **Bunny.net** (no per-request fee).
Providers are chosen by **egress model**, not VM price. Cloudflare audio paths only with fair-use validation;
CloudFront only if already AWS-locked.

## 10. Engineering practices (quality bar)

**Test-Driven Development is mandatory** for all new and changed behaviour — see [ADR D14](./docs/ADRS.md#d14--test-driven-development-is-mandatory).

- **Test-first, red→green→refactor.** Write a failing `*.spec.ts` that pins the intended behaviour, watch it
  fail, write the minimum code to pass, then refactor under green. No production logic merges without a test
  that was written to fail first; bug fixes start with a failing regression test.
- **Vitest**, unit tests next to the code as `<name>.spec.ts`, fully mocked (no real Postgres/Liquidsoap/
  network). Run `pnpm test` (CI), `pnpm test:watch` (dev), `pnpm test:coverage`. Coverage is a per-change
  ratchet — new/changed lines covered, suite stays green — not a chase to 100%.
- **Integration/e2e stays real and separate:** the docker-compose engine validation (real Liquidsoap 2.2.x +
  Icecast, DJ ingest, HLS/Icecast output) is the integration layer and is **not** mocked into the unit suite.
- **Backlog:** a CI workflow that runs `pnpm test` on every PR and blocks merge on red. Until then TDD is
  enforced by discipline and review.
