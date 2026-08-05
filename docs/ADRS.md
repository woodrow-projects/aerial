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
| D7  | Live streamer ingest via desktop source software first (BUTT/Mixxx); WebRTC later | Accepted |
| D8  | Metadata via a cacheable `nowplaying.json` side-channel + ICY for Icecast | Accepted |
| D9  | Public surface: endpoints + metadata API only (no listen page in v1) | Accepted |
| D10 | Security baseline (hashed keys, TLS, operator accounts, kill switch) | Accepted |
| D11 | SQLite file-backed state + off-VM backup; S3-compatible media; Caddy proxy | Amended 2026-07-17 |
| D12 | Opinionated defaults ON (R128 loudness, gapless, auto-TLS, sane bitrates) | Accepted |
| D13 | Operator auth via better-auth (rejected OpenAuth) | Accepted |
| D14 | Test-Driven Development is mandatory (Vitest; test-first) | Accepted |
| D15 | SPA UI built on shadcn/ui (Radix + Tailwind), TanStack Router/Query | Accepted |
| D16 | CLI station state: local config + provider labels; no hosted state service | Accepted |
| D17 | Control-plane-owned deterministic Auto-DJ queue via request.dynamic | Accepted |
| D18 | Schedule-aware, enforced-by-default streamer auth; multi-user roles | Accepted |
| D19 | Observability: OTel instrumentation, export-only; no bundled backend; in-UI dashboard deferred | Accepted |

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

## D7 — Live streamer ingest via desktop source software first

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
  Icecast/source ports sit behind the TLS terminator. *Implemented:* streamer ingest is TLS-terminated by Caddy via
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

**Decision (amended 2026-07-17).** **SQLite** (Prisma, WAL mode) as the only database — one file
(`/srv/data/aerial.db` on the `data` volume) with an **off-VM backup** to S3-compatible storage. Auto-DJ
media (fast-follow) lives in **S3-compatible object storage** (Hetzner Object Storage / Backblaze B2).
**Caddy** terminates TLS and serves HLS segments as the CDN origin.

**Rationale.** The control plane's write load is tiny (operator CRUD + one row per stream session; listener
traffic never touches the DB), so Postgres's strengths — concurrent-write scaling, pooling, replication —
are unreachable under the single-VM design (D1) while its failure modes (password drift, auth failures,
container health) were the installer's worst support surface. SQLite makes backup/restore the product story:
copy one file, resurrect the station anywhere. SQLite's dialect has no enum/scalar-list columns, so those
fields are TEXT validated by the shared zod schemas (`src/prisma/db-columns.ts`); WAL + `busy_timeout` are
set at connect. A future hosted tier or multi-node design re-opens this decision — the app layer is kept
provider-agnostic (zod unions, no raw SQL) so re-adding Postgres is a schema+deploy exercise.

**Superseded original (2026-06).** Postgres in-compose, chosen for the growing analytics/cost surface and
the future hosted tier; dropped pre-v1 in favour of operational simplicity — dual-provider Prisma support
(two schemas, two migration histories) was rejected as a permanent 2× maintenance tax whose barely-tested
Postgres path would serve exactly the most data-sensitive users worst.

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

**Decision.** Use **better-auth** (in-app, Prisma-native) for operator auth. better-auth owns the
`user/session/account/verification` tables (the unused legacy `User` model was dropped); its web handler is
mounted on a raw Fastify route `/api/auth/*`; a global Nest `AuthGuard` validates the session on every
controller route, with `@Public()` exempting `/internal/*` (which keeps its token guard) and the future
public analytics beacon. The SPA uses `better-auth/react` (same-origin — no CORS/baseURL). Sessions are
httpOnly + SameSite=Lax cookies (Secure in production). Social providers (Google/GitHub) are **env-gated**:
off in v1, switched on by setting credentials and rebuilding — no handler/guard change.

**Rejected — OpenAuth (`@openauthjs/openauth`).** A standalone OAuth2 **issuer** (a 5th internet-facing
service) whose reason to exist (multi-app SSO, multi-tenant token issuance, third-party API clients) is
unused for one operator on a same-origin SPA. It has no first-party SQL storage adapter (only
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
  database, no real Liquidsoap, no network — collaborators (Prisma, `http.post`, the engine) are mocked.
  Harness: `apps/control-plane/vitest.config.ts`; run with `pnpm test` (CI), `pnpm test:watch` (dev),
  `pnpm test:coverage`.
- **Coverage is a ratchet, not a gate-to-100.** New/changed lines must be covered; the suite must stay
  green. Wiring-only files (`*.module.ts`, `main.ts`) are excluded — they carry no logic worth a unit test.
- **Integration/e2e stays real and separate.** The docker-compose engine validation (real Liquidsoap +
  Icecast, streamer ingest, HLS/Icecast output) remains the integration layer and is **not** mocked into the unit
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
`test` script across the workspace. The backlogged CI gate shipped 2026-07-28:
`.github/workflows/ci.yml` runs `pnpm typecheck` + `pnpm test` on every PR and push to main
(mark the `test` check Required under branch protection to make red actually block merge).

## D15 — SPA UI built on shadcn/ui (Radix + Tailwind)

**Context.** The operator SPA shipped as plain React with a single hand-written 251-line `styles.css` and all
components inline in `App.tsx` — no component library, no design system, no accessibility baseline.
`docs/ARCHITECTURE.md` already *names* "shadcn/Radix + Tailwind" as the intended stack, but it was never
actually adopted. As the panel grows (user management, schedule calendar, more channel controls), bespoke CSS
per component scales poorly and inconsistently.

**Decision.** Standardize the SPA on **shadcn/ui primitives** — Radix UI under the hood, Tailwind for
styling, `class-variance-authority` for variants. **Refactor the existing screens onto shadcn**, and build
**all new UI** from shadcn primitives by default. Routing is **TanStack Router** and server state is
**TanStack Query** (see [`docs/plans/spa-ui-foundation.md`](./plans/spa-ui-foundation.md)).

**Rationale.** shadcn gives an accessible, composable, *ownable* component set (the code is vendored into the
repo, not a black-box dependency), themed via Tailwind tokens so deferred brand work
([`docs/plans/spa-branding.md`](./plans/spa-branding.md)) drops in cleanly. It realizes the
opinionated-modern-UX differentiator (D12, SPEC §7) at low cost and makes new feature screens fast and
consistent.

**Rejected.**
- *Keep hand-rolled CSS:* already inconsistent, no a11y baseline, and every new screen re-solves layout/state.
- *A batteries-included kit (MUI/Chakra):* heavier runtime, opinionated styling that's harder to theme to a
  custom brand, and a black-box dependency vs vendored, editable components.
- *Headless-only (Radix/Headless UI alone):* rebuilds the variant/styling layer shadcn already provides.

---

## D16 — CLI station state: local config + provider labels; no hosted state service

**Context.** The `aerial` CLI (see `docs/plans/`) provisions **stations** (one domain → one VM → one
Aerial install; see `CONTEXT.md`) on cloud providers on the user's behalf. A user may run several
stations across several providers and needs to list, add, and tear them down. Where does that
inventory live?

**Decision.** **The provider is the database.** Every resource the CLI creates (VM, DNS record,
firewall, SSH key) is tagged/labeled at the provider (`managed-by=aerial`,
`aerial-station=<domain>`). The CLI keeps only a local config dir (`~/.config/aerial/`): saved
provider API tokens plus a *cache* of known stations. `aerial ls` reconstructs truth by
label-filtered provider API queries; `aerial down <station>` deletes exactly the labeled resource
set. The CLI is imperative (create/list/destroy), so no declarative state diffing — and therefore no
Terraform-style state file — is needed. The CLI operates strictly at station level; channels are the
control panel's job.

**Rationale.** Full multi-station management UX ("two stations live, tear down one, spin up a
third") with **zero infrastructure Aerial hosts or pays for**. Recovery story: lost laptop →
re-enter the API token → `aerial ls` finds everything by label. Precedent: `doctl`/`flyctl`-style
imperative CLIs.

**Rejected.**
- *Hosted state/account service (`aerial login`):* permanent infra + cost + a privacy surface, to
  solve a problem labels already solve. Re-opened only if a hosted tier (health notifications,
  cross-device continuity) ever exists.
- *Fully stateless CLI (spin up and forget):* forces manual teardown in the provider console —
  exactly the surface the CLI exists to hide.
- *Terraform/OpenTofu under the hood:* brings the state-file problem back plus a runtime dependency;
  overkill for an imperative create/list/destroy lifecycle.

---

## D17 — Control-plane-owned deterministic Auto-DJ queue

**Context.** Auto-DJ playout (docs/plans/auto-dj-and-scheduling.md) needs track selection that is
deterministic, inspectable ("why did this track play?"), and editable without audio gaps. The
alternatives were Liquidsoap-side playlists (the prior watched-directory `playlist()` source) or
AzuraCast-style engine-managed rotation.

**Decision.** **The control plane owns track selection; Liquidsoap just plays what it's told.** The
per-channel script's Auto-DJ source is `request.dynamic` pulling `POST /internal/next-track`, which
resolves the active Show → Clock (or the channel's `defaultClock`), advances a persisted per-channel
slot pointer (`ClockState`) over the expanded slot sequence, picks from the slot's playlist honoring
its order (sequential / shuffle-with-dedup-window / random, seeded RNG), returns an `annotate:` URI
carrying cue/fade metadata, and writes a `PlayLog` decision row — the operator-visible "why".
Never-silent: a `live` show with no connected streamer and unscheduled time both fall to
`defaultClock`; no clock → the engine's `mksafe` silence. Library/clock/schedule edits are DB
changes picked up on the next pull — the engine supervisor restarts a channel only when its
generated script text actually changes.

**Rejected.** *Watched-directory playlists* (no structure, no dedup, no attribution);
*engine-owned rotation* (opaque, per-engine state, contradicts the inspectability goal);
*raw-`.liq` escape hatches* (the AzuraCast footgun the plan explicitly avoids).

---

## D18 — Schedule-aware, enforced-by-default streamer auth + roles

**Context.** ADR D10 introduced per-channel stream keys with no notion of *who* streams; the plan
requires enforced streamer scheduling (AzuraCast's is advisory) and a read-only `streamer` role.

**Decision.** A broadcaster is a **User** (`admin` | `streamer`) holding a server-generated,
bcrypt-hashed **per-user streamer key**. Harbor auth (`/internal/auth`) identifies the user by key
and — when `Channel.enforceSchedule` (default **true**) — admits them only during a `live` Show they
own, within a configurable grace window (`SCHEDULE_GRACE_MIN`, default 5). Admins are not exempt:
enforcement is purely schedule-driven, so behavior is predictable for every operator. Accepted
connections record identity + source address server-side, attributed to the `StreamSession`
(D10 logging: mount/time/source IP/streamer). RBAC: every mutating API route is admin-only via
`RolesGuard` (a reflection spec pins that role metadata is never shipped unguarded); streamers get
read-only panel access. Legacy per-channel StreamKeys keep working as an **advisory fallback**
(back-compat: they authenticate anytime, with no user identity) — deliberately weaker, documented,
and destined for deprecation once per-user keys are universal.

**Rejected.** *Advisory-by-default* (the AzuraCast weakness the plan targets); *a standalone
Streamer entity* (a User with a role covers it — better-auth stays the single account system);
*role-exempting admins from schedule enforcement* (surprising on-air behavior beats convenience).

---

## D19 — Observability: OTel instrumentation, export-only; no bundled backend; in-UI dashboard deferred

**Context.** The stack has no instrumentation of any kind: no `/metrics`, no health endpoint, no
structured logging (7 unstructured `@nestjs/common` Logger instances writing to stdout), no scheduler
(`@nestjs/schedule` is not a dependency), and no Nest interceptors/filters/middleware at all. Meanwhile
`README.md`, `docs/ARCHITECTURE.md` and `SPEC.md` §5/§7 already *advertise* a cost-transparency and
listener-analytics dashboard that has **zero lines of code**. A 2026-08 design pass asked the obvious
question: adopt OpenTelemetry, add a Prometheus container, and build an operator-facing telemetry
dashboard into the panel?

**Decision.**

1. **Adopt OpenTelemetry as the instrumentation layer**, and do it independently of any dashboard work.
   Instrument the control plane once, in vendor-neutral vocabulary.
2. **Bundle no observability backend.** No Prometheus, Grafana, Loki, Tempo, or collector container.
   OTLP export is **off unless the operator sets an endpoint** — one env var, zero containers. A default
   install stays at three containers.
3. **Traces are instrumented but are not a product surface** — exported if an endpoint is configured,
   never stored locally, never rendered in the SPA.
4. **Logs get structure and rotation, not a viewer.** Structured output plus a Compose `logging:` cap;
   raw log lines remain a `docker compose logs` / OTLP concern.
5. **The in-UI observability dashboard is deferred** (see below), not rejected.
6. **When it is built, audience and health stay separate.** Audience analytics is a durable *product*
   feature (the SPEC §7.3 wedge) and belongs in SQLite; system health is disposable *ops* data. One UI
   surface may present both, but they never share a store.

**Rationale.** The target box is small and chosen by price: both provisioning adapters floor at 2 GB RAM
and pick the cheapest qualifying instance (`packages/cli/src/providers/hetzner.ts`,
`digitalocean.ts`), and every Liquidsoap encoder already runs *inside* the control-plane container, so
headroom shrinks with channel count. A Prometheus + Grafana + Loki + Tempo + collector stack is five
containers and roughly 850 MB — on a box where [D1](#d1--orchestration-docker-compose-not-kubernetes)
rejected Kubernetes partly over a "~0.5–1 GB control-plane RAM tax", and where
[D11](#d11--data--storage) dropped Postgres because container failure modes were "the installer's worst
support surface". That stack is also, almost exactly, the monitoring topology already discarded with the
AWS/SST design (`docs/legacy/ORIGINAL_DIAGRAM-aws-sst.md`). Export-only inverts the cost/benefit: an
operator who already runs an observability backend gets everything for one env var, and the operator who
does not — the persona in SPEC §2 — pays nothing and has nothing new to recover at 2am.

Traces specifically: Aerial is one process with four cross-boundary calls, all Liquidsoap →
control-plane (`/internal/{auth,status,metadata,next-track}`). Distributed tracing earns its keep across
process boundaries, and there effectively are none — so a trace UI would be the most expensive and least
used thing in the plan. They are instrumented rather than skipped because [D5](#d5--control-plane-nestjs-fastify-adapter--reactvitets-spa-one-container-for-v1)
reserves extracting the engine supervisor into its own process, at which point they stop being pointless.

**Why the dashboard is deferred** (recorded so the analysis is not re-derived):

- **The CDN inversion.** [D2](#d2--delivery-hls-first--cdn-with-a-parallel-origin-direct-icecast-mount)'s
  entire thesis is that origin egress stays ~constant whether serving 100 or 100k listeners. Origin-side
  listener counting therefore does not merely degrade at scale — it **inverts**, going blind at the exact
  moment the audience becomes worth measuring. Any credible design must read usage back from the CDN.
- **Three paths, three fidelities.** Icecast gives exact concurrency for free; HLS-at-origin gives an
  inference and currently has *no substrate at all* (`deploy/caddy/Caddyfile` has no `log` directive and
  there is no log volume); the CDN gives a lagging, aggregate, provider-shaped number. "Listener count" is
  not one number, and presenting it as one would mislead operators about a figure they budget against.
- **No client to instrument.** [D9](#d9--public-surface-endpoints--metadata-api-only-no-listen-page-in-v1)
  ships no player, so a client beacon can be offered but never relied on. (The `@Public()` seam reserved
  for it in `auth.guard.ts` stays reserved and unbuilt.)
- **It contradicts a load-bearing sentence in D11.** SQLite-only is justified there on the grounds that
  "listener traffic never touches the DB". A sampler writing rows on an interval invalidates that, and
  needs an amendment rather than a silent contradiction.
- **No scheduler exists.** Every time-driven behaviour today is *pulled* by Liquidsoap; a poller is a new
  architectural primitive.

Each is answerable — the likely shape is a single canonical unit (listener-seconds) that every path can
report, with measured and estimated figures visibly distinguished — but together they make this a real
design project rather than the fast-follow the docs imply.

**Rejected.**
- *A bundled Prometheus/Grafana stack:* five containers, ~850 MB, its own passwords/ports/volumes/upgrade
  path and 2am failure mode, on a 2 GB box — for a feature the operator did not ask to self-host.
- *Prometheus as the store for audience analytics:* wrong retention (an operator will ask about last
  October), wrong provenance for a billing-adjacent number, and it makes the wedge differentiator vanish
  whenever the optional container is not running.
- *A trace viewer in the SPA*, and *a raw log viewer in the SPA:* both expensive, neither actionable for
  the target persona.
- *Doing nothing until the dashboard is designed:* instrumentation is useful on its own and is the input
  the dashboard will need anyway.

**Consequence.** `README.md`, `docs/ARCHITECTURE.md` and `SPEC.md` §5/§7 currently assert analytics that
do not exist, and the CLI warns operators they will lose "listener history" that was never stored — these
overstate the product and should be reconciled. Two unrelated defects surfaced during this design pass and
are tracked separately: Icecast's stats endpoints are reachable unauthenticated through the Caddy
`/icecast/*` catch-all, and no Compose service sets a `logging:` cap, leaving container logs unrotated on a
small disk.
