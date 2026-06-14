# Aerial

**A CDN-native, self-hosted online radio platform you can ship with ease.**

Aerial lets one operator stand up an online radio on a single cheap VM with one command, run a handful of
channels (e.g. *main + secondary*, *music + talk*), broadcast live, and share stream endpoints to embed
anywhere. When the audience grows, delivery scales by flipping on a CDN — no re-platforming, no surprise bill.

It's a modern, opinionated alternative to AzuraCast.

> **Design principle:** self-host the lightweight *brain*; rent the bandwidth-bound *edge* over cacheable
> HLS — and only when the audience justifies it.

## Why Aerial

- **Scales out of the box.** HLS segments are CDN-cacheable, so origin load stays ~constant whether you serve
  100 or 100k listeners. Surviving a hug-of-death is a one-toggle CDN provision, not a re-architecture.
- **No surprise bills.** A built-in cost-transparency dashboard projects egress spend from listener counts,
  with spend caps and alerts.
- **Zero Kubernetes.** One `docker compose up` on one VM. Opinionated defaults (loudness normalization,
  gapless, auto-TLS) are on by default.
- **First-class multi-channel** and an **API-first** design — operators embed the stream and now-playing data
  in their own sites.

## How it works (in one picture)

```
DJ (BUTT/Mixxx) ─▶ TLS ─▶ Liquidsoap (per channel) ─┬─▶ HLS rendition set ─▶ Caddy ─▶ [CDN] ─▶ web/mobile
                                                     └─▶ Icecast mount  ────▶ Caddy ─────────▶ VLC/Sonos/car
NestJS control plane: channels · stream keys · supervises Liquidsoap · now-playing · cost   (state ▶ Postgres)
```

Two delivery paths: **HLS** (default — CDN-cacheable, web/mobile) and an origin-direct **Icecast** mount
(low-latency, legacy/interactive, directories). The CDN only ever serves HLS.

## Stack

- **Control plane:** NestJS (Fastify adapter), TypeScript
- **Web UI:** React + Vite + TypeScript (served by the control-plane container in v1)
- **Audio engine:** Liquidsoap (one process per channel) + Icecast
- **Edge / TLS:** Caddy (auto Let's Encrypt) → optional Bunny.net CDN over HLS
- **State:** Postgres
- **Deploy:** Docker Compose on one flat-bandwidth VM (Hetzner recommended)

## Status

🟢 **v1 core built and validated end-to-end.** The architecture/decisions are locked, the monorepo is
scaffolded, and the live pipeline has been run via `docker compose up` against real Liquidsoap 2.2.5 +
Icecast: channel CRUD → engine spawn → HLS + Icecast delivery → stream-key-authed DJ ingest → fallback↔live
crossfade → now-playing. Next: Auto-DJ, CDN toggle, cost dashboard (fast-follow).

- Product spec → [`SPEC.md`](./SPEC.md)
- Architecture + diagram → [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- Decision records (with rejected alternatives) → [`docs/ADRS.md`](./docs/ADRS.md)
- Superseded designs (K3s, AWS/SST) → [`docs/legacy/`](./docs/legacy)

## Roadmap

1. **v1 — live + self-host:** multi-channel live ingest, HLS + Icecast, now-playing, auto-TLS. Listenable
   with no CDN.
2. **Fast-follow:** Auto-DJ + media library, one-toggle CDN, cost-transparency dashboard.
3. **Scale + harden:** CDN-over-HLS at large scale, warm-standby origin (HA). Later: in-browser "Go Live",
   PaaS template, optional hosted tier.

## License

TBD.
