# Liquidsoap engine

There is **no Dockerfile here**: Liquidsoap is bundled into the control-plane
image (`apps/control-plane/Dockerfile`) because the engine supervisor spawns one
`liquidsoap` **child process per channel** (ADR D5/D6).

The per-channel `.liq` script is **generated at runtime** from
[`apps/control-plane/src/engine/liq-template.ts`](../../apps/control-plane/src/engine/liq-template.ts)
and written under `LIQUIDSOAP_CONFIG_ROOT`. Each script:

- runs a `fallback([live, loop])` with `track_sensitive=false` (instant streamer cutover)
  and an `mksafe` loop (the mount never drops),
- authenticates the harbor source against the control plane (`/internal/auth`),
- reports connect/disconnect to `/internal/status` and metadata to `/internal/metadata`,
- emits **two outputs**: an HLS rendition set (AAC) + one Icecast mount (MP3).

Put shared static `.liq` helpers/includes here later if the generated scripts
grow enough to warrant factoring common code out.
