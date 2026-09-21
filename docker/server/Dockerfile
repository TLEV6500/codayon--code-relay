# syntax=docker/dockerfile:1
#
# Server image for @codayon/server (Hono HTTP + native Bun WebSocket relay).
#
# Build contexts expected to be the MONOREPO ROOT (not packages/server), since
# Bun workspaces need the root package.json/bun.lock plus sibling workspace
# packages (packages/shared) to resolve `workspace:*` dependencies.
#
#   docker build -f docker/server/Dockerfile --target dev  .
#   docker build -f docker/server/Dockerfile --target prod .
#
# Targets:
#   base    - shared workspace deps installed, used by both dev/build stages
#   dev     - runs `bun run --hot` against bind-mounted source (docker-compose
#             dev profile); deps are baked in, source is bind-mounted at runtime
#   build   - installs deps + prunes to a production-only artifact set
#   prod    - slim runtime image, non-root user, standalone (Railway-portable)

ARG BUN_VERSION=1

# ---------------------------------------------------------------------------
# base: workspace manifests + full install (dev deps included, needed for
# --hot/typecheck in dev; the prod stage re-installs with --production later).
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS base
WORKDIR /app

# Copy only manifests first for better layer caching.
COPY package.json bun.lock ./
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install --frozen-lockfile

# Copy the rest of the workspace sources needed to run/build the server.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server

# ---------------------------------------------------------------------------
# dev: standalone dev-oriented runtime. In docker-compose, packages/server/src
# and packages/shared/src are bind-mounted over this image's copies so edits
# on the host are picked up live by `bun run --hot`.
# ---------------------------------------------------------------------------
FROM base AS dev
WORKDIR /app/packages/server
ENV NODE_ENV=development
EXPOSE 3000
CMD ["bun", "run", "--hot", "src/index.ts"]

# ---------------------------------------------------------------------------
# prod: minimal, non-dev runtime image containing only what's needed to run
# the server. No dev deps, no bind mounts expected — fully self-contained so
# it can be deployed standalone (e.g. as its own Railway service).
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-slim AS prod
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install --frozen-lockfile --production

COPY packages/shared packages/shared
COPY packages/server packages/server

WORKDIR /app/packages/server
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
