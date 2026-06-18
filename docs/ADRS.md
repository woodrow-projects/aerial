# Architecture Decision Records — Aerial

Authoritative record of the architectural decisions for **Aerial**, a CDN-native, self-hosted online radio
platform. These supersede the original K3s spec (`docs/legacy/SPEC-v1-k3s.md`) and the AWS/SST design
(`docs/legacy/ORIGINAL_DIAGRAM-aws-sst.md`).

**Guiding goal:** a person with only basic technical knowledge can ship an online radio *with ease*.
**Reframing fact:** audio delivery is **bandwidth-bound, not CPU-bound** — a persistent Icecast stream
cannot be CDN-cached, but **segmented HLS can**. That single property dictates the whole design.

| #   | Decision | Status |
|-----|----------|--------|
| D1  | Orchestration: Docker Compose, not Kubernetes | Accepted |
| D2  | Delivery: HLS-first + CDN, with a parallel origin-direct Icecast mount | Accepted |
| D3  | Scaling lever: bytes (NIC headroom → CDN → relay nodes), not pods/tasks | Accepted |
| D4  | Provider chosen by egress model; Hetzner default, Bunny CDN default | Accepted |
| D5  | Control plane: NestJS (Fastify adapter) + React/Vite/TS SPA, one container for v1 | Accepted |
| D6  | One Liquidsoap process per channel, spawned dynamically | Accepted |
| D7  | Live DJ ingest via desktop source software first (BUTT/Mixxx); WebRTC later | Accepted |
| D8  | Metadata via a cacheable `nowplaying.json` side-channel + ICY for Icecast | Accepted |
| D9  | Public surface: endpoints + metadata API only (no listen page in v1) | Accepted |
| D10 | Security baseline (hashed keys, TLS, operator accounts, kill switch) | Accepted |
| D11 | Postgres in-compose + off-VM backup; S3-compatible media; Caddy proxy | Accepted |
| D12 | Opinionated defaults ON (R128 loudness, gapless, auto-TLS, sane bitrates) | Accepted |
| D13 | Operator auth via better-auth (rejected OpenAuth) | Accepted |
| D14 | Test-Driven Development is mandatory (Vitest; test-first) | Accepted |

---

## D1 — Orchestration: Docker Compose, not Kubernetes

**Context.** The original spec ran everything on K3s + KEDA + Traefik on a single VM.

**Decision.** Use a plain **Docker Compose** stack on one VM.

**Rationale.** On a single node, Kubernetes delivers none of its multi-node benefits while imposing all of
its cost — CRDs, StatefulSet/PVC, `IngressRouteTCP`, KEDA `ScaledObject`s, CrashLoop debugging, a
~0.5–1 GB control-plane RAM tax — and a non-developer cannot stand it up or recover it at 2am. Compose
yields the identical single-box result with roughly 10× less to break and a real one-command install.

**Rejected.**
- *K3s/KEDA (original SPEC.md):* KEDA-scaling relay pods on one VM adds **zero** listener bandwidth (all
  pods share one NIC); the autoscaler reads the master's `icestats.listeners`, which counts relay *pull*
  connections, not audience; non-dev-hostile.
- *AWS/SST/Fargate (ORIGINAL_DIAGRAM):* the most expensive place to ship bytes (egress $0.05–0.09/GB →
  ~$24–26k/mo at 10k listeners), ~$150–300/mo idle floor (NAT GW + NLB + RDS + always-on Fargate),
  CloudFront fronts only the admin UI (audio is L4-NLB passthrough, uncacheable), worst non-dev deploy,
  maximal lock-in.

---

## D2 — Delivery: HLS-first + CDN, with a parallel origin-direct Icecast mount

**Decision.** Every channel emits **two outputs from one Liquidsoap pipeline**: (1) an **HLS rendition set**
(AAC; e.g. HE-AAC 64k + AAC-LC 128k for adaptive mobile, ~4s segments) as immutable cacheable files, and
(2) **one low-latency Icecast mount** (MP3 128k for broad legacy compatibility).

**Rationale.** HLS segments are immutable cacheable objects, so origin egress stays ~constant whether
serving 100 or 100k listeners — making 10k+/viral a *budget* question, not a re-platform. HLS also fixes
iOS/Safari reliability and HTTPS embedding. The Icecast mount is retained for ~2–8s latency, legacy/hardware
players (VLC, Sonos, car head units), interactive use, and stream directories (TuneIn / Icecast-YP).

**Hard rule.** The CDN *only ever* serves HLS objects. **Never** fan out the persistent Icecast stream
through a CDN — it cannot be cached and the entire scale thesis collapses.

**Rejected.** A relay fleet of any kind (KEDA pods or ECS tasks) — uncacheable, simultaneously the most
complex and least scalable component; replaced entirely by HLS-over-CDN.

---

## D3 — Scaling lever: bytes, not pods/tasks

**Decision.** Scale in this order: (a) **vertical NIC headroom** first (2.5/10 Gbit box), then (b)
**CDN-over-HLS**, optionally (c) **self-run Icecast relay *nodes*** on separate VMs for the legacy/directory
path. Never same-host pods.

**Rationale.** The bottleneck is the NIC line rate and the monthly egress bill, neither of which more
same-host processes can relieve. A single tuned Icecast already serves thousands; v1 on one flat-bandwidth
VM comfortably handles low-thousands of concurrent listeners.

---

## D4 — Provider chosen by egress model; Hetzner + Bunny defaults

**Decision.** Default origin host **Hetzner** (EU; ~€1/TB after included allowance, or unmetered dedicated).
Default CDN **Bunny.net** (bandwidth-only, no per-request fee).

**Rationale.** Bandwidth, not VM price, is the entire cost story. At 10k listeners egress is ~$440/mo on
Hetzner vs ~$25k/mo on AWS (~10–85× spread between providers). "Cloud-agnostic" is dropped as a goal.

**Caveats.** Cloudflare's ToS forbids disproportionate self-serve audio/video streaming — use Cloudflare
R2+CDN only with explicit fair-use validation and keep Workers off the per-segment hot path. CloudFront only
if already AWS-locked.

**Pluggability (backlog).** HLS delivery is just origin-pull of static HTTP objects, so *any* HTTP CDN
works — the CDN is a **"bring your own CDN" provider interface**, not hardwired to Bunny. Two tiers:
(1) **universal/manual** — point any CDN's pull zone at the Caddy origin + set the public base URL (zero
code per provider); (2) **auto-provisioned** one-toggle wizard — per-provider API adapters, Bunny first,
then e.g. Gcore / CDN77 / Cloudflare. A self-host-ethos alternative is a **DIY edge**: nginx/Varnish caching
relay nodes on cheap flat-bandwidth VMs behind GeoDNS (an `nginx proxy_cache` over static HLS is a mini-CDN),
which reuses the relay-node path in [D3](#d3--scaling-lever-bytes-not-podstasks).

---

## D5 — Control plane: NestJS (Fastify adapter) + React/Vite/TS SPA, one container for v1

**Decision.** Build the control plane in **NestJS on the Fastify adapter** (TypeScript); ship the **React +
Vite + TS** SPA as static assets served by the same container in v1.

**Rationale.** The backend's hard part is **lifecycle/orchestration of long-lived stateful components**, not
HTTP routing: spawning/draining per-channel Liquidsoap, the metadata pump, scheduled rollups, queues. That
is Nest's home turf — lifecycle hooks (`OnApplicationBootstrap`/`OnModuleDestroy` + `enableShutdownHooks`),
DI for stateful singletons, `@nestjs/schedule` and later `@nestjs/bullmq`, a module system that scales with
features, and `@nestjs/swagger` for the API-first OpenAPI contract → generated SDKs in any language. The
Fastify adapter adds performance + a schema ecosystem. The owner is experienced with Nest, so its ceremony
is proportionate, not a tax.

**Rejected.**
- *Next.js full-stack:* route handlers are request-scoped; the daemon work needs a separate worker anyway,
  eroding the "single unit" win; SSR is irrelevant with no public listen page.
- *Hono:* excellent for thin/edge APIs, but its RPC client is TypeScript-coupled (weaker than OpenAPI SDKs
  for third-party operators) and it is "bring your own" for lifecycle/jobs. Note: the constraint that ruled
  it out is the *edge runtime*, not Hono itself — Hono on Node is capable; Nest simply fits a daemon-heavy,
  growing backend better here.

**Architecture note.** v1 runs as one Nest app (API + engine-supervisor module). Clean module boundaries let
the worker be extracted into its own process (Nest monorepo / microservice transport) later for crash
isolation or the hosted tier — without a rewrite.

---

## D6 — One Liquidsoap process per channel, spawned dynamically

**Decision.** Target scope is a **few channels (2–5)**. Run **one Liquidsoap process per channel**, spawned
and supervised by the control plane from generated config.

**Rationale.** Per-channel processes give the best fault isolation and trivial config-gen, and adding a
channel becomes **config, not infra** (no Compose edit/restart). One Icecast container hosts all channel
mountpoints.

**Reserved.** A shared multi-output engine + per-channel quotas if a future "dozens of channels" topology is
needed.

---

## D7 — Live DJ ingest via desktop source software first

**Decision.** v1 ingest is **desktop Icecast source software (BUTT/Mixxx)** with copy-paste presets +
downloadable config, authenticated by per-channel stream key. **In-browser WebRTC "Go Live"** is a future
goal.

**Rationale.** Desktop source ingest is proven and simple to build; WebRTC ingest is a large addition
(WebRTC→Liquidsoap path). **Drop OBS** from all guidance — it is video/RTMP-first and misleads non-devs for
audio.

---

## D8 — Metadata via a cacheable side-channel

**Decision.** Liquidsoap `on_metadata` → a tiny API → **`nowplaying.json`** (short TTL, CDN-cacheable) for
HLS/web consumers; inline **ICY `StreamTitle`** for Icecast legacy players (free).

**Rationale.** In-band HLS ID3 timed metadata is buggy and inconsistent across players; a cacheable JSON
side-channel is simpler, CDN-friendly, and exactly what operators need to power their own now-playing UI.

---

## D9 — Public surface: endpoints + metadata API only (no listen page in v1)

**Decision.** v1 exposes, per channel: the **HLS `.m3u8` URL**, the **Icecast mount URL**, and
**`nowplaying.json`**. No branded/full listen page.

**Rationale.** Radio operators have strong opinions on their own UX and embed the stream in *their own*
sites. An **API-first / bring-your-own-frontend** stance is leaner *and* a differentiator. An optional
minimal embeddable player is deferred.

---

## D10 — Security baseline (non-negotiable)

**Decision.**
- Stream keys are **server-generated, high-entropy, bcrypt-hashed, constant-time compared** — never
  user-chosen, never plaintext.
- All secrets live in **git-ignored env**, never in repo config XML.
- **TLS mandatory** (Caddy + automatic Let's Encrypt) on the listener and control-plane endpoints; raw
  Icecast/source ports sit behind the TLS terminator. *Implemented:* DJ ingest is TLS-terminated by Caddy via
  the `caddy-l4` layer4 plugin (the harbor ports are internal-only); see `ARCHITECTURE.md`.
- Add an **operator account** model (`users`) for the control panel (the original spec had no human/owner
  concept).
- Per-channel **kill switch** (`is_active`), per-stream logging (mount/time/source IP), an abuse contact,
  and terms placing music-licensing responsibility on the operator.

**Rationale.** Plaintext audio is mixed-content-blocked on HTTPS sites and flaky on iOS; cleartext keys and
secrets-in-repo are a breach waiting to happen; anonymous unlogged streams invite DMCA/abuse takedowns of
the whole box.

---

## D11 — Data & storage

**Decision.** **Postgres** in-compose (Prisma or Drizzle — chosen at scaffold time) with a **nightly off-VM
backup** to S3-compatible storage. Auto-DJ media (fast-follow) lives in **S3-compatible object storage**
(Hetzner Object Storage / Backblaze B2). **Caddy** terminates TLS and serves HLS segments as the CDN origin.

**Rationale.** The off-VM backup is the single highest-value reliability fix for a single-VM design. Postgres
(over SQLite) is chosen for the growing analytics/cost surface and the future hosted tier.

---

## D12 — Opinionated defaults ON

**Decision.** EBU **R128 loudness normalization**, **gapless**, **auto-TLS**, and **sane default bitrates**
are ON by default with few knobs.

**Rationale.** A ruthlessly opinionated, great-defaults UX is a deliberate differentiator versus AzuraCast's
dense power-user surface, and it directly serves the "ship with ease" goal.

---

## D13 — Operator auth via better-auth (rejected OpenAuth)

**Context.** The control plane shipped with an unauthenticated `/api/*` surface (only `/internal/*` was
token-guarded). It needs operator login before exposing sensitive mutations (media upload, CDN API keys,
spend caps). Near-term needs: a few operator accounts + social/SSO (Google/GitHub).

**Decision.** Use **better-auth** (in-app, Postgres/Prisma-native) for operator auth. better-auth owns the
`user/session/account/verification` tables (the unused legacy `User` model was dropped); its web handler is
mounted on a raw Fastify route `/api/auth/*`; a global Nest `AuthGuard` validates the session on every
controller route, with `@Public()` exempting `/internal/*` (which keeps its token guard) and the future
public analytics beacon. The SPA uses `better-auth/react` (same-origin — no CORS/baseURL). Sessions are
httpOnly + SameSite=Lax cookies (Secure in production). Social providers (Google/GitHub) are **env-gated**:
off in v1, switched on by setting credentials and rebuilding — no handler/guard change.

**Rejected — OpenAuth (`@openauthjs/openauth`).** A standalone OAuth2 **issuer** (a 5th internet-facing
service) whose reason to exist (multi-app SSO, multi-tenant token issuance, third-party API clients) is
unused for one operator on a same-origin SPA. It has no first-party Postgres storage adapter (only
Memory/DynamoDB/Cloudflare KV), bypasses the existing `User` model, forces an SMTP email flow for register,
and is pre-1.0 / dormant (0.4.3, transferred out of the SST org). It contradicts the "minimal moving parts,
non-developer can recover it" goal. better-auth covers the few-accounts + social/SSO needs in-app with zero
new services.

**Consequence.** better-auth is ESM-only and NestJS builds CommonJS, so the runtime needs `require(ESM)` —
the control-plane image was bumped from Node 20.18 to **Node 26** (also requires `libatomic1` in the savonet
base). See `docs/DEVELOPMENT.md` for the first-operator seed flow and env vars.

---

## D14 — Test-Driven Development is mandatory

**Context.** The v1 core was de-risked by **manual** end-to-end validation against the real engine
(Liquidsoap 2.2.5 / Icecast 2.4) via `docker compose up` — the right call for proving an unusual
audio-delivery architecture, but it shipped **zero automated tests**. The core contracts are now locked
(ADR D1–D13), so the regression risk of changing them silently is high and rising.

**Decision.** **TDD is non-negotiable for all new and changed behaviour going forward.** Concretely:

- **Test-first, red→green→refactor.** Write a failing `*.spec.ts` that pins the intended behaviour, watch it
  fail, then write the minimum code to pass, then refactor under green. No production logic lands without a
  test that was written to fail first.
- **Vitest** is the runner. Unit tests live **next to the code** as `<name>.spec.ts` and are pure: no real
  Postgres, no real Liquidsoap, no network — collaborators (Prisma, `http.post`, the engine) are mocked.
  Harness: `apps/control-plane/vitest.config.ts`; run with `pnpm test` (CI), `pnpm test:watch` (dev),
  `pnpm test:coverage`.
- **Coverage is a ratchet, not a gate-to-100.** New/changed lines must be covered; the suite must stay
  green. Wiring-only files (`*.module.ts`, `main.ts`) are excluded — they carry no logic worth a unit test.
- **Integration/e2e stays real and separate.** The docker-compose engine validation (real Liquidsoap +
  Icecast, DJ ingest, HLS/Icecast output) remains the integration layer and is **not** mocked into the unit
  suite; it is run/automated separately (backlog: wire it into CI).
- **Bug fixes start with a failing regression test** that reproduces the bug before the fix.

**Rationale.** The control plane's hard parts — stream-key issuance/verification (D10), the per-channel
Liquidsoap config generator (D2/D6), the fail-closed internal-token guard (D10), engine lifecycle — are
exactly the logic where a silent regression is most damaging and least visible by eye. These are also highly
unit-testable (a pure config generator; pure-ish guards; services over a mockable Prisma), so the cost of
test-first is low and the payoff is direct. Test-first (vs test-after) is mandated because it forces the
contract to be stated before the implementation biases it, and guarantees the test can actually fail.

**Rejected.**
- *Test-after / "we'll add tests later":* the v1 reality shows "later" became "never"; it also lets tests
  ratify whatever the code happens to do rather than the intended contract.
- *Mocking the engine into the unit suite as the only coverage:* a mocked Liquidsoap proves nothing about
  the real 2.2.x signatures — the compose-based integration check is irreplaceable and is kept distinct.
- *A hard global coverage threshold (e.g. 90%):* on a codebase starting near 0% this blocks all work or
  invites assertion-free filler tests; a per-change ratchet targets the lines that actually changed.

**Consequence.** First suite stood up in `apps/control-plane`: `liq-template.spec.ts` (config generator,
100%), `internal-token.guard.spec.ts` (fail-closed auth, 100%), `stream-keys.service.spec.ts` (issuance +
verification). `vitest` + `@vitest/coverage-v8` are dev dependencies; `turbo run test` already fans the
`test` script across the workspace. **Backlog:** a CI workflow (`.github/workflows`) that runs `pnpm test`
on every PR and blocks merge on red — until then, TDD is enforced by discipline and review.
