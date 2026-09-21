# FEAT-002 — Docker Compose Integration — Tasks

**Status legend:** `[x]` complete · `[~]` in progress · `[ ]` not started
**Source:** [`requirements.md`](./requirements.md) · [`design.md`](./design.md)

Each task is a working, demoable increment, verified against a running
container/stack, ending by wiring into the previous task's output. No
orphaned code.

---

- [x] **Task 1 — Server Dockerfile (dev-oriented, standalone)**
  - `docker/server/Dockerfile` `dev` target: `oven/bun`, workspace manifests
    copied first for layer caching, `bun install --frozen-lockfile`, then
    `packages/shared` + `packages/server` sources, `CMD ["bun", "run",
    "--hot", "src/index.ts"]`.
  - **Requirements:** REQ-001.
  - **Verified:** `docker build -f docker/server/Dockerfile --target dev .`
    succeeds; `docker run -p 3000:3000` responds `200` on `GET /health`
    (`{"status":"ok",...}`) and `201` on `POST /api/rooms` with a valid room
    payload.

- [x] **Task 2 — Client Dockerfile (dev-oriented, standalone)**
  - `docker/client/Dockerfile` `dev` target: `oven/bun`, workspace manifests +
    `bun install --frozen-lockfile`, then `packages/shared` + `packages/client`
    sources, `CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0"]`.
  - **Requirements:** REQ-002.
  - **Verified:** `docker build -f docker/client/Dockerfile --target dev .`
    succeeds; `docker run -p 5173:5173` serves the SPA shell (`<div
    id="root">`, `/src/main.tsx` script tag) confirmed via `curl`; Vite logs
    show `ready` and bound to `0.0.0.0`.

- [x] **Task 3 — docker-compose dev profile wiring server + client (no nginx yet)**
  - `docker-compose.yml` `dev` profile: `server` + `client` services on a
    shared `codayon` bridge network; bind-mounts for
    `packages/server/src`, `packages/client/src`, `packages/shared/src`;
    `packages/client/vite.config.ts` updated so the dev proxy target is
    overridable via `VITE_PROXY_TARGET` (defaults unchanged for non-Docker
    use), set to `http://server:3000` in Compose.
  - **Requirements:** REQ-003, REQ-004.
  - **Verified:** `docker compose --profile dev up -d --build` starts both
    containers; `curl localhost:3000/health` and `curl localhost:5173/`
    succeed directly; `curl -X POST localhost:5173/api/rooms` succeeds
    through Vite's proxy to the `server` service by Docker DNS name; editing
    `packages/server/src/app.ts` on the host (temporarily changing the health
    status string) was reflected in the running container's `/health`
    response within ~1.5s via `bun run --hot`, then reverted and reconfirmed
    back to the original value — no container restart performed.

- [x] **Task 4 — Introduce nginx for dev profile (same-origin routing)**
  - `docker/nginx/nginx.conf` (shared server block: `/ws` with full upgrade
    headers, `/api`, `/health`, `include .../root.active.conf`);
    `docker/nginx/root.dev.conf` (proxies `/` to `http://client:5173`);
    `docker/nginx/root.prod.conf` (static `try_files` + SPA fallback, wired
    for Task 8); `docker/nginx/entrypoint.sh` (copies the profile-appropriate
    root config based on `NGINX_PROFILE` before starting nginx). `nginx`
    service added to the `dev` Compose profile using the stock
    `nginx:1.27-alpine` image with all four files bind-mounted in (no custom
    image build needed for dev).
  - **Requirements:** REQ-005, REQ-006.
  - **Verified:** with the full dev stack up, `curl localhost:8080/` returns
    the client shell, `curl localhost:8080/health` and `curl -X POST
    localhost:8080/api/rooms` return correct server responses — all through
    nginx on one origin. WebSocket upgrade verified via nginx's own access
    log: `GET /ws?code=...&clientToken=... HTTP/1.1" 101 0` — HTTP 101
    confirms nginx forwarded the `Upgrade`/`Connection` headers and the
    server completed the protocol switch. Full message-exchange round trip
    also confirmed: a Bun WebSocket test client sent `{"channel":"doc","type":
    "getDocument"}` through nginx (`ws://localhost:8080/ws?...`) and received
    `{"channel":"doc","type":"document","version":0,"doc":""}` back, followed
    by a clean close (code 1000) — verified both directly against the server
    (port 3000) and through nginx (port 8080) with identical results. (An
    earlier attempt omitted the required `channel: "doc"` field in the test
    message, causing the server to silently ignore it per `ws.ts`'s
    `if (msg.channel === "doc")` dispatch — a test-script defect, not an
    application or proxy defect; corrected and re-verified.)

- [ ] **Task 5 — `.env.example` and environment variable wiring**
  - Extract nginx's published port, server `PORT`, and client dev port into
    Compose-level environment variables with defaults; add `.env.example`;
    confirm `.env` overrides are picked up on restart.
  - **Requirements:** REQ-010.

- [ ] **Task 6 — Server Dockerfile: production multi-stage build**
  - Add a `prod` target to `docker/server/Dockerfile`: `oven/bun` build stage
    -> `oven/bun:1-slim` runtime, non-root user, `--production` install,
    `bun run src/index.ts`.
  - **Requirements:** REQ-007; NFR-003.

- [ ] **Task 7 — Client Dockerfile: production build + static output**
  - Add a `build` stage running `vite build` with `ARG VITE_API_URL=""` /
    `ENV VITE_API_URL` passthrough, and a `prod` stage (`FROM scratch`)
    exposing only the built `dist/` for `COPY --from=` consumption.
  - **Requirements:** REQ-008.1, REQ-008.3.

- [ ] **Task 8 — docker-compose prod profile wiring: dedicated nginx image + prod stack**
  - `docker/nginx/Dockerfile`: multi-stage, `COPY --from=` the client's build
    stage's `dist/` into `/usr/share/nginx/html`, `NGINX_PROFILE=prod` baked
    in. `prod` Compose profile wiring this nginx image + the Task 6 server
    `prod` target, no bind mounts, no shared volumes.
  - **Requirements:** REQ-008.2, REQ-009.
