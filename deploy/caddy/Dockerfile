# Custom Caddy with the layer4 plugin, so Caddy can terminate TLS for the raw
# Icecast *source* (DJ ingest) protocol and proxy it to the per-channel Liquidsoap
# harbors — reusing the same Let's Encrypt certs it manages for HTTPS (ADR D10/D11).
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-l4

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
