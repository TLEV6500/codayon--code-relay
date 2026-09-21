# FEAT-002 — Docker Compose Integration

## 1. Introduction

### 1.1 Product Context

Codayon's monorepo (`packages/server` — Hono HTTP + native Bun WebSocket
relay; `packages/client` — Vite/SolidJS SPA; `packages/shared` — protocol
types) currently runs only via local `bun run` scripts. This document
specifies **FEAT-002**: integrating the existing project with **Docker
Compose** for local runtime orchestration and sandboxing. This is purely an
operational/infrastructure feature — it introduces no new product behavior
and changes no application requirements from FEAT-001.

Requirements are **implementation-agnostic** where practical, but because this
feature is inherently about container/orchestration tooling, some acceptance
criteria intentionally name concrete tools (Docker, Docker Compose, nginx,
`oven/bun`) as the chosen implementation, consistent with how FEAT-001's
design.md records approved technology decisions rather than treating them as
non-binding.

### 1.2 In Scope

- **Two Docker Compose profiles:**
  - **dev** — bind-mounted source for live edit reflection, dependencies baked
    into images at build time, server run with Bun's `--hot` and client run
    via the Vite dev server.
  - **prod** — fully baked, multi-stage production images (no bind mounts),
    static client build served by nginx.
- **nginx as a same-origin reverse proxy** in front of both profiles, routing
  `/` to the client and `/api` + `/ws` to the server, so the browser only ever
  talks to one origin (mirroring the existing Vite dev-proxy shape).
- **WebSocket upgrade support through nginx** for the application's own
  real-time relay endpoint (`/ws`), in both profiles.
- **Dockerfiles structured to be deployable as standalone Railway services
  later** (each Dockerfile builds and runs independently of the Compose file,
  since Railway does not execute `docker-compose.yml` directly).
- **`.env.example`** documenting configurable variables (ports, etc.) with
  sane defaults, consumed by Compose via a git-ignored `.env`.
- **Debug port access**: the server and client containers' native ports
  remain published to the host in the dev profile, in addition to nginx's
  port, for direct debugging.

### 1.3 Out of Scope (deferred to future specifications)

- **Persistence services** (PostgreSQL, Redis, or any database/cache). Room
  state remains in-memory only, as in FEAT-001. Introducing session/code/user
  persistence is deferred to a future feature.
- **Railway-specific configuration** (`railway.json`, `railway.toml`, or any
  Railway CLI/dashboard setup). Railway-compatibility in this slice is a
  **design constraint on the Dockerfiles only** — no Railway deployment
  artifacts are produced.
- **TLS termination.** Not handled by this feature's nginx configuration;
  local Compose usage is plain HTTP. (Production platforms such as Railway
  terminate TLS at their own edge, independent of this feature.)
- **Preserving Vite's Hot Module Replacement (HMR) through nginx.** The dev
  profile's nginx proxy does not forward Vite's HMR WebSocket; a manual
  browser refresh after a client edit is accepted behavior for this slice.
- **CI/CD pipeline integration.** This feature covers local
  `docker compose up` usage only.

### 1.4 Non-Binding Design Context

- Railway maps each Docker Compose service to an individual Railway service
  rather than executing the Compose file directly; this informs the
  Dockerfile-standalone-runnability constraint but does not require any
  Railway-side artifact in this slice.
- Postgres + Redis is the anticipated pairing for a future persistence
  feature (durable session/user/code data + fast ephemeral session state),
  noted here only as forward context — not implemented.

## 2. Glossary

| Term | Definition |
|------|------------|
| **Profile** | A Docker Compose `profiles` grouping that selects which services start for a given `docker compose --profile <name> up` invocation. This feature defines `dev` and `prod`. |
| **Same-origin routing** | Serving the client UI and the API/WebSocket relay under one origin (host:port) via a reverse proxy, so the browser makes no cross-origin requests. |
| **Bind mount** | A Docker volume mapping a host directory into a container so file edits on the host are immediately visible inside the running container. |
| **Multi-stage build** | A Dockerfile technique using multiple `FROM` stages so build-time tooling/dependencies are not carried into the final runtime image. |
| **Baked-in dependencies** | Dependencies installed into the Docker image at build time (`bun install` during `docker build`), as opposed to being installed on the host and volume-mounted in. |
| **Debug port** | A container's native application port (e.g., 3000, 5173) published directly to the host in addition to the nginx entry point, for direct access during development. |

## 3. Personas

- **Contributor / Developer.** Runs the project locally for development.
  Wants a single command to bring up the full stack (server + client + nginx)
  with live-reloading source, without manually running multiple `bun`
  processes or managing ports by hand.
- **Maintainer preparing for deployment.** Wants Dockerfiles and a prod
  Compose profile that closely approximate how the app would run in a
  production-like container environment (e.g., ahead of a future Railway
  deployment), without the project depending on Compose itself in production.

## 4. Functional Requirements

Acceptance criteria use EARS keywords: **WHEN** (event-driven), **WHILE**
(state-driven), **IF/THEN** (conditional), and **SHALL** (mandatory behavior).

### 4.1 Containerized Services

#### REQ-001 — Standalone server container
**User story:** As a Developer, I want the server to run correctly inside a
container by itself, so that it is portable and not dependent on Compose.

Acceptance criteria:
1. THE SYSTEM SHALL provide a Dockerfile that builds a runnable image for
   `packages/server` using the official `oven/bun` base image.
2. WHEN the server image is run standalone (no Compose, no other containers),
   THE SYSTEM SHALL serve its existing HTTP API (including `GET /health`) on
   the port specified by the `PORT` environment variable, defaulting to 3000.
3. THE SYSTEM SHALL install server dependencies (including the `shared`
   workspace package) at image build time via `bun install --frozen-lockfile`,
   not via a runtime/volume-mounted `node_modules`.

#### REQ-002 — Standalone client container
**User story:** As a Developer, I want the client to run correctly inside a
container by itself, so that it is portable and not dependent on Compose.

Acceptance criteria:
1. THE SYSTEM SHALL provide a Dockerfile that builds a runnable image for
   `packages/client` using the official `oven/bun` base image.
2. WHEN the client's dev-target image is run standalone, THE SYSTEM SHALL
   serve the Vite dev server on port 5173, reachable from outside the
   container (bound to `0.0.0.0`).
3. THE SYSTEM SHALL install client dependencies (including the `shared`
   workspace package) at image build time via `bun install --frozen-lockfile`.

### 4.2 Dev Profile Orchestration

#### REQ-003 — Dev profile brings up the full stack
**User story:** As a Developer, I want one command to start the entire dev
stack, so that I don't need to run server/client processes manually.

Acceptance criteria:
1. WHEN a Developer runs `docker compose --profile dev up`, THE SYSTEM SHALL
   start the server, client, and nginx services on a shared Docker network.
2. WHILE the dev profile is running, THE SYSTEM SHALL make the application
   reachable through a single nginx entry point as well as directly via the
   server's and client's own published debug ports.

#### REQ-004 — Live source reflection in dev
**User story:** As a Developer, I want to edit source files on my host and see
the change take effect in the running containers immediately, so that my
edit-test loop stays fast.

Acceptance criteria:
1. THE SYSTEM SHALL bind-mount `packages/server/src`, `packages/client/src`,
   and `packages/shared/src` from the host into their respective dev-profile
   containers.
2. THE SYSTEM SHALL NOT bind-mount `node_modules`; installed dependencies
   SHALL remain baked into the image.
3. WHEN a file under a bind-mounted `src` directory is modified on the host,
   THE SYSTEM SHALL reflect that change in the running container's behavior
   without requiring an image rebuild (via Bun's `--hot` for the server and
   Vite's own file watcher for the client).

### 4.3 Same-Origin Routing via nginx

#### REQ-005 — Single-origin access to client and API
**User story:** As a Developer, I want to reach the whole app through one
origin, so that the browser never has to make cross-origin requests to the
API or WebSocket relay.

Acceptance criteria:
1. THE SYSTEM SHALL run nginx as a reverse proxy in both the dev and prod
   profiles.
2. WHEN a request path begins with `/api`, THE SYSTEM SHALL proxy it to the
   server container in both profiles.
3. WHEN a request targets any other path in the **dev** profile, THE SYSTEM
   SHALL proxy it to the client's Vite dev server.
4. WHEN a request targets any other path in the **prod** profile, THE SYSTEM
   SHALL serve the pre-built static client assets directly, falling back to
   `index.html` for client-side routes.
5. THE SYSTEM SHALL use a single shared nginx configuration source (not two
   independently maintained full configs) with only the minimal dev/prod
   routing difference isolated and selected at container start.

#### REQ-006 — WebSocket relay upgrade through nginx
**User story:** As a Participant, I want the real-time collaboration relay to
keep working when accessed through nginx, so that same-origin routing doesn't
break live sync.

Acceptance criteria:
1. WHEN a client requests a WebSocket upgrade on `/ws`, THE SYSTEM SHALL proxy
   the request to the server container with `Upgrade` and `Connection` headers
   forwarded, in both the dev and prod profiles.
2. THE SYSTEM SHALL NOT require Vite's own Hot-Module-Replacement WebSocket to
   be proxied through nginx for this requirement to be satisfied.

### 4.4 Production Profile

#### REQ-007 — Production server image
**User story:** As a Maintainer, I want a production-shaped server image, so
that the container running in a production-like environment carries no dev
tooling.

Acceptance criteria:
1. THE SYSTEM SHALL provide a multi-stage build producing a slim runtime image
   for the server, running as a non-root user.
2. THE SYSTEM SHALL run the production server target without any bind-mounted
   source or dev dependency.

#### REQ-008 — Production client build and static serving
**User story:** As a Maintainer, I want the client compiled to static assets
and served by nginx, so that the prod profile matches a realistic deployment
shape.

Acceptance criteria:
1. THE SYSTEM SHALL provide a build stage that runs the client's production
   build (`vite build`) and produces static output.
2. THE SYSTEM SHALL provide a dedicated nginx image build that copies the
   static output from the client's build stage into the image (no bind mounts
   or shared runtime volumes required to serve it).
3. THE SYSTEM SHALL accept a build-time variable for a client API base URL
   (e.g. `VITE_API_URL`) that, if unset, preserves today's relative-path
   (`/api`, `/ws`) behavior.

#### REQ-009 — Prod profile brings up a stateless stack
**User story:** As a Maintainer, I want the prod profile to run without any
dev-only containers or bind mounts, so that it approximates a real deployment.

Acceptance criteria:
1. WHEN a Maintainer runs `docker compose --profile prod up`, THE SYSTEM SHALL
   start only the production server and the static-serving nginx image — no
   separate long-running client container.
2. THE SYSTEM SHALL NOT bind-mount any source directory in the prod profile.

### 4.5 Configuration

#### REQ-010 — Documented, overridable configuration
**User story:** As a Developer, I want configurable values documented in one
place, so that I can override ports and similar settings without editing
Dockerfiles or the Compose file.

Acceptance criteria:
1. THE SYSTEM SHALL provide a checked-in `.env.example` documenting every
   Compose-consumed environment variable (at minimum: nginx's published port,
   the server's `PORT`, and the client's dev port) with a sane default.
2. THE SYSTEM SHALL read actual values from a git-ignored `.env` file when
   present, falling back to the defaults declared in `docker-compose.yml`.
3. WHEN a value in `.env` is changed and the stack is restarted, THE SYSTEM
   SHALL reflect the new value without requiring edits to `docker-compose.yml`
   or any Dockerfile.

## 5. Non-Functional Requirements

#### NFR-001 — Railway portability
Each Dockerfile SHALL build and run correctly when invoked standalone (outside
Compose, with no dependency on another Compose service being present), so
that it can later be deployed as an individual Railway service without
modification.

#### NFR-002 — No behavior change to existing application requirements
This feature SHALL NOT alter any FEAT-001 application-level behavior (room
lifecycle, roles, turn engine, real-time sync, presence). It is strictly an
orchestration/runtime concern.

#### NFR-003 — Image hygiene
Production images SHALL exclude dev dependencies and SHALL run as a non-root
user. Production images SHOULD be measurably smaller than their dev-target
counterparts.

#### NFR-004 — No accidental persistence
Nothing in this feature SHALL introduce a database, cache, or persistent
volume for application data; room state remains in-memory only, matching
FEAT-001.
