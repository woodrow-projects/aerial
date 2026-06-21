# Plan: Automated Icecast relay provisioning & balancing

> **Status: planned (Scale + harden).** A one-command way to add an Icecast **relay** edge: get a new VM, run
> an install-script-style tool, and it stands up an Icecast that relays the origin's mounts — the Icecast
> analogue of the one-toggle CDN for HLS. Completes Aerial's delivery coverage to **four modes**: HLS,
> CDN-backed HLS, single-origin Icecast, and **relayed Icecast**.

## Why

CDN-over-HLS (D2/D3) covers the cacheable path, but the origin-direct **Icecast** mount can't be CDN-cached.
For operators leaning on Icecast (legacy players, directories, low latency), horizontal **relay nodes** are
the bytes-not-pods scaling lever (D3 already names "relay nodes"). The relay path is *configured* but not
*automated* today.

## What exists today

- `engine/icecast/icecast.xml.template` already sets `<relay-password>` = `<source-password>`, so a relay can
  authenticate as a source pull — the door is open, just unautomated.
- Mounts are created dynamically by the per-channel Liquidsoap; one Icecast hosts all mounts; it is internal,
  fronted by Caddy.

## Single-VM assumptions to revisit (the real work)

- `config/env.ts` hardcodes the Icecast host (the `icecast` Docker service name) — relays need an addressable
  origin + per-node identity.
- Caddy's layer4 ingest block is a static `8100–8110` map on one host, and `/srv/hls` is a shared local
  volume — neither is multi-VM today.
- No model of relay nodes, channel→relay assignment, or which node served a session (`StreamSession`).

## Open questions

- **Provisioning:** a `relay-install.sh` (curl | bash, like `deploy/install.sh`) taking the origin host +
  relay credentials and rendering a relay-only `icecast.xml` with `<relay>` blocks per mount.
- **Balancing & routing:** how listeners reach the nearest/healthy relay — GeoDNS, a control-plane redirect,
  or relay URLs advertised in `nowplaying.json`. Needs a relay registry + health checks.
- **Control-plane coupling:** a `Relay` model (endpoint, region, status) so the panel can list/monitor relays
  and emit relay-aware Icecast URLs.

> **Candidate ADR (not yet Accepted):** relay/edge scaling topology + listener balancing strategy — lock when
> we commit to an approach.

Cross-ref: ADR D2 (delivery), D3 (scaling lever → relay nodes), D4 (provider/egress); SPEC §8 (Scale + harden).
