# Aerial control-plane image: the Liquidsoap 2.2.x engine (savonet, with ffmpeg
# support compiled in) plus Node — the API + SPA + supervisor that spawns one
# liquidsoap child process per channel (ADR D5/D6). Build context is the repo root.
FROM savonet/liquidsoap:v2.2.5

USER root
ENV NODE_VERSION=20.18.0

# Node from the official arch-aware tarball (NodeSource doesn't track Debian sid).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl xz-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ARCH="$(uname -m)" \
 && case "$ARCH" in \
      x86_64) NODEARCH=x64 ;; \
      aarch64) NODEARCH=arm64 ;; \
      *) echo "unsupported arch: $ARCH" && exit 1 ;; \
    esac \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODEARCH}.tar.xz" -o /tmp/node.tar.xz \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.xz \
 # Install pnpm directly (avoid corepack: bundled keys in Node 20.18 fail pnpm signature verification).
 && npm install -g pnpm@9.12.0

WORKDIR /repo

# Install workspace deps (copy manifests first for layer caching).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY apps/control-plane/package.json apps/control-plane/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile || pnpm install

# Build shared lib, generate Prisma client, build API and SPA.
COPY . .
RUN pnpm --filter @aerial/shared build \
 && pnpm --filter @aerial/control-plane exec prisma generate \
 && pnpm --filter @aerial/control-plane build \
 && pnpm --filter @aerial/web build \
 && mkdir -p /app/web && cp -r apps/web/dist/* /app/web/

ENV NODE_ENV=production
ENV WEB_DIST=/app/web
ENV LIQUIDSOAP_BIN=/usr/bin/liquidsoap
WORKDIR /repo/apps/control-plane
EXPOSE 3000

# Reset the savonet base image's `liquidsoap` entrypoint so our CMD runs in a shell.
ENTRYPOINT []

# Sync schema (scaffold uses `db push`; switch to `migrate deploy` once migrations
# exist), then start.
CMD ["sh", "-c", "pnpm exec prisma db push --skip-generate && node dist/main.js"]
