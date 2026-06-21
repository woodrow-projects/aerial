# Plan: One-Toggle CDN (Bunny)

> **Status: planned / deferred.** Approved in principle; pick up after the current milestone. This is the
> headline differentiator (ADR D4, SPEC §7.1–7.2) and the dependency keystone for the cost dashboard and
> CDN-aware analytics. Auth (ADR D13) — a prerequisite for storing the CDN API key — is now in place.

## Why

Audio delivery is bandwidth-bound (ADR D2/D3). HLS segments are CDN-cacheable, so fronting them with a CDN
keeps origin load ~constant under a viral spike. The classic pain is that wiring up a CDN by hand (pull zone,
origin, cache rules, TLS, DNS) is exactly where a non-developer stalls. This feature collapses that into one
switch — "going viral becomes a budget line, not a re-platform."

## Operator experience ("one-toggle")

1. **One-time:** paste a **Bunny.net API key** in Settings. *(The only thing Aerial can't auto-provision —
   it requires a Bunny account.)*
2. Flip **"Enable CDN."**
3. Aerial calls the Bunny API: creates a **pull zone** with origin = `PUBLIC_BASE_URL`, sets cache rules
   (respect origin `Cache-Control` — Caddy already emits `no-cache` for `.m3u8`, immutable for segments), and
   returns a free **`<zone>.b-cdn.net`** hostname with **instant TLS and zero DNS**.
4. Each channel's **HLS endpoint now resolves to the CDN** (`https://<zone>.b-cdn.net/hls/<slug>/live.m3u8`);
   the **Icecast mount and streamer ingest stay origin-direct** (D2 hard rule — never CDN the persistent stream).
5. Status: **provisioning → active**. Toggle **off** reverts endpoints to the origin immediately (pull zone
   left intact so existing embeds keep working).

The decision that makes it truly one-toggle: the free **`b-cdn.net` subdomain** (instant cert, no DNS step)
for v1. A vanity custom domain (operator CNAME + cert) is later scope.

## Implementation plan

- **Schema:** a singleton `CdnConfig` — `provider`, `status` enum (`disabled → provisioning → active | error`),
  `pullZoneId`, `cdnHostname`, **encrypted** `apiKey`, timestamps. Migration.
- **Secret at rest:** new `APP_SECRET` env + an **AES-256-GCM** encrypt/decrypt util for the API key (NOT
  bcrypt — it must be replayable to Bunny). `install.sh` generates `APP_SECRET`.
- **`CdnProvider` interface + Bunny adapter:** `provision()`, `configure()`, `teardown()`, returns the
  `b-cdn.net` hostname; calls Bunny's REST API. Pluggable per ADR D4 ("bring your own CDN") so Gcore/CDN77/
  Cloudflare adapters can follow.
- **Provisioning state machine:** idempotent — persist `pullZoneId` *before* further config so a retry
  resumes instead of creating a duplicate zone; transition to `error` with a message on failure.
- **Endpoint rewrite:** `channels.service.endpoints()` resolves an `hlsBaseUrl` (CDN host when `active`, else
  origin); `hls` + `nowPlaying` use it; `icecast` + `ingest` always pinned to the origin (enforces D2 in code).
- **API (operator-authed):** `GET /api/cdn` (status), `PUT /api/cdn/key`, `POST /api/cdn/enable`,
  `POST /api/cdn/disable`.
- **SPA:** a CDN settings card — paste key, enable/disable toggle, status (provisioning/active/error), show
  the CDN hostname.

## Prerequisites

- A **Bunny.net account** + account-level API key (operator-provided; gates the toggle).
- A **publicly-reachable HTTPS origin** — Bunny origin-pull needs a valid public cert (works in prod via
  Caddy + Let's Encrypt; does **not** work against a `localhost` internal-CA box).
- `APP_SECRET` for at-rest key encryption.

## Validation plan + boundary

- **Locally validatable against a fake/mock `CdnProvider`:** the state machine, key encryption/decryption,
  the endpoint rewrite (HLS → CDN, Icecast/ingest → origin), and the API/SPA flow.
- **Not locally validatable:** the **live Bunny round-trip** — it needs a real API key *and* a publicly
  reachable origin. Validate that with a real key against a deployed/public origin (operator-run, or a
  provided test key).

## Risks

- The non-dev "ease" promise lives or dies on the auto-provisioning genuinely working (pull zone + cache +
  TLS). If it slips, the differentiator regresses to "AzuraCast with extra steps."
- **Honest cost framing:** the CDN is the spike/global/scale layer, *not* the baseline cost win — at steady
  low-thousands a flat-bandwidth origin can be cheaper. Frame it accordingly in the UI (ties into the cost
  dashboard).
- Cloudflare's ToS forbids disproportionate self-serve streaming → **default Bunny**; only offer Cloudflare/R2
  with fair-use validation.
