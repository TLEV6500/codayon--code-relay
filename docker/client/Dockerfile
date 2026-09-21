# syntax=docker/dockerfile:1
#
# Client image for @codayon/client (Vite + SolidJS SPA).
#
# Build context expected to be the MONOREPO ROOT (not packages/client), for
# the same workspace-resolution reason as docker/server/Dockerfile.
#
#   docker build -f docker/client/Dockerfile --target dev  .
#   docker build -f docker/client/Dockerfile --target prod .
#
# Targets:
#   base    - shared workspace deps installed
#   dev     - runs the Vite dev server (bind-mounted source in compose)
#   build   - runs `vite build`, producing static assets in dist/
#   prod    - build stage's dist/ output only (consumed via COPY --from= by
#             docker/nginx/Dockerfile; this stage itself is not run standalone)

ARG BUN_VERSION=1

# ---------------------------------------------------------------------------
# base: workspace manifests + full install.
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/client packages/client

# ---------------------------------------------------------------------------
# dev: standalone dev-oriented runtime. In docker-compose, packages/client/src
# and packages/shared/src are bind-mounted over this image's copies so edits
# on the host are picked up live by Vite's watcher.
# ---------------------------------------------------------------------------
FROM base AS dev
WORKDIR /app/packages/client
ENV NODE_ENV=development
EXPOSE 5173
CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0"]

# ---------------------------------------------------------------------------
# build: produces the static production bundle. VITE_API_URL is plumbed
# through for future configurability (e.g. if client/server are ever split
# across origins); it currently defaults to empty, which preserves today's
# relative-path (`/api`, `/ws`) behavior since no client code reads
# `import.meta.env.VITE_API_URL` yet.
# ---------------------------------------------------------------------------
FROM base AS build
WORKDIR /app/packages/client
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}
RUN bun run build

# ---------------------------------------------------------------------------
# prod: exposes only the built static assets as a copyable stage. Intended to
# be consumed via `COPY --from=` (see docker/nginx/Dockerfile), not run on its
# own — there is no Bun/Node runtime needed to serve static files.
# ---------------------------------------------------------------------------
FROM scratch AS prod
COPY --from=build /app/packages/client/dist /dist
