# Codayon — Turn-Based Code Relay Platform

Codayon is a gamified, turn-based collaborative code relay platform for educational workshops, mentorship, and team-building coding relays. Participants take timed turns driving a shared code editor while others watch live with real-time presence (cursors, selections). One person types at a time; control passes predictably via round-robin rotation or host-controlled manual pass.

## Features

### FEAT-001: Turn-Based Code Relay Foundation

The core collaboration backbone with minimal shared editor:

- **Ephemeral sessions** — room codes, no persistent accounts, one-time-use host tokens
- **Real-time multiplayer** — live shared document via `@codemirror/collab` (CodeMirror 6 Operational Transformation), server-side authority, broadcast via Bun's native pub/sub
- **Presence awareness** — live cursors/selections, anchor via logical positions to prevent drift across concurrent edits
- **Turn engine** — fixed-duration turns with optional early-end, round-robin or manual driver selection, fair late-comer insertion, disconnect grace period + host prompt
- **Role enforcement** — Host (admin), Observer (eligible Driver), Spectator (watch-only), read-only enforcement server-side
- **Syntax highlighting** — CodeMirror language support (TypeScript, Python, SQL, JavaScript, HTML, CSS, JSON, YAML, etc.)
- **Minimal editor** — no autocomplete, no in-browser execution (deferred to future features)

**Tech stack:**
- **Backend:** Bun + Hono (HTTP) + native Bun WebSocket (relay authority)
- **Frontend:** SolidJS + Vite + Tailwind CSS v4 + CodeMirror 6
- **Runtime:** Bun 1.4+, TypeScript end-to-end
- **Monorepo:** Bun workspaces (`packages/server`, `packages/client`, `packages/shared`)

### FEAT-002: Docker Compose Integration

Production-ready containerization with dev/prod orchestration:

- **Two Compose profiles:**
  - **`dev`** — bind-mounted source, live reload, Bun `--hot`, Vite file watcher, nginx same-origin reverse proxy
  - **`prod`** — fully baked multi-stage images, static client build, minimal footprint, no dev tooling
- **Same-origin routing** — nginx reverse proxy unifies client (`/`) and server (`/api`, `/ws`) under one origin, avoiding CORS/mixed-origin WebSocket issues
- **WebSocket support** — full upgrade header forwarding for real-time relay in both dev and prod
- **Multi-stage builds** — server prod image 46% smaller (258 MB vs 478 MB dev), no dev dependencies
- **Railway-compatible** — each Dockerfile runs standalone; services deployable as individual Railway services later
- **Configurable** — `.env.example` with port/env var defaults, `.env` (gitignored) for overrides

### FEAT-003: Session UI/UX Completion (In Progress)

Closes gaps between server-modeled capabilities and the client UI — features that were already implemented in the turn engine/protocol but never surfaced to users:

- **Turn timer end-to-end** — server-side scheduler auto-expires fixed-duration turns and broadcasts a live countdown (previously: turns never ended automatically; only manual/early-end worked)
- **Driver & turn visibility** — current driver name and turn number shown to all participants
- **Manual driver assignment UI** — host picker to choose the next driver by name (manual selection policy)
- **Rotation order visibility** — round-robin order and "who's up next" shown to all participants
- **Disconnect grace period UX** — visible countdown for all users + host reassign/extend/skip actions when a driver or host disconnects mid-turn
- **Host-specific disconnect indicator** — distinct, always-visible signal when the host (not just any participant) disconnects
- **Control rejection & session-ended feedback** — clear, human-readable feedback instead of silent failures or a frozen editor

See `docs/requirements/FEAT-003-session-ux-completion/` for the full gap audit, requirements, and design.

## Quick Start

### Prerequisites

- **Bun 1.4+** ([install](https://bun.sh))
- **Docker + Docker Compose** ([install](https://docs.docker.com/compose/install/))

### Development: Run Locally with Docker Compose

```bash
# Clone and enter the repo
git clone <repo-url>
cd codayon--code-relay

# Start the full dev stack (server + client + nginx)
docker compose --profile dev up

# Access the app
open http://localhost:8080
```

The dev stack brings up:
- **nginx** on port `8080` (configurable via `NGINX_PORT` env var) — reverse proxy entry point
- **server** on port `3000` (configurable via `SERVER_PORT`) — Hono HTTP API + WebSocket relay
- **client** on port `5173` (configurable via `CLIENT_PORT`) — Vite dev server

Edit source code (`packages/server/src`, `packages/client/src`, `packages/shared/src`) on your host — changes are reflected immediately in running containers via Bun's `--hot` and Vite's file watcher.

#### Custom Ports

Create `.env` to override defaults:

```bash
cat > .env << EOF
NGINX_PORT=9000
SERVER_PORT=3001
CLIENT_PORT=5174
EOF

docker compose --profile dev up
```

Then access the app at `http://localhost:9000`.

#### Stop Services

```bash
docker compose --profile dev down
```

### Development: Run Locally without Docker

If you prefer running directly with Bun:

```bash
# Install dependencies (all workspaces)
bun install

# Terminal 1: start the server
bun run --cwd packages/server dev

# Terminal 2: start the client
bun run --cwd packages/client dev

# Access the app
open http://localhost:5173
```

The client's Vite dev server will proxy `/api` and `/ws` requests to `http://localhost:3000` (the server).

### Production: Docker Compose Prod Profile

```bash
# Build and start the prod stack (nginx-prod + server-prod only)
docker compose --profile prod up

# Access the app
open http://localhost:8080
```

The prod stack brings up:
- **nginx-prod** — serves pre-built static client assets, proxies `/api` + `/ws` to server
- **server-prod** — production-shaped server container (no dev deps, non-root user)

No bind mounts, no dev tooling — fully baked, stateless, production-grade.

#### Custom Port

```bash
echo "NGINX_PORT=9000" > .env
docker compose --profile prod up
```

Access at `http://localhost:9000`.

## Project Structure

```
.
├── packages/
│   ├── server/          # Hono HTTP + Bun native WebSocket relay
│   │   └── src/
│   │       ├── index.ts         # Bun.serve entrypoint
│   │       ├── app.ts           # Hono HTTP routes (create/join/bootstrap)
│   │       ├── ws.ts            # WebSocket handler, message dispatch
│   │       ├── relay.ts         # RoomDoc authority (OT reconciliation)
│   │       └── routes/rooms.ts  # Room lifecycle endpoints
│   ├── client/          # SolidJS + Vite + Tailwind + CodeMirror
│   │   ├── src/
│   │   │   ├── main.tsx         # Entry point
│   │   │   ├── App.tsx          # Lobby + session view
│   │   │   └── ...
│   │   └── vite.config.ts       # Vite config (dev proxy configurable)
│   └── shared/          # Protocol types + turn engine (pure logic)
│       └── src/
│           ├── protocol.ts      # Wire message types
│           ├── engine.ts        # Turn state machine
│           └── ...
├── docker/              # Container configs
│   ├── server/Dockerfile        # Multi-stage: dev + prod targets
│   ├── client/Dockerfile        # Multi-stage: dev + build + prod targets
│   └── nginx/
│       ├── Dockerfile           # Prod-only nginx image
│       ├── nginx.conf           # Shared routing config
│       ├── root.dev.conf        # Dev variant (proxy to Vite)
│       ├── root.prod.conf       # Prod variant (static files + SPA fallback)
│       └── entrypoint.sh        # Profile selection + hostname substitution
├── docker-compose.yml           # Dev + prod profiles
├── .env.example                 # Configurable env vars (ports, etc.)
├── package.json                 # Root monorepo workspace config
├── bun.lock                     # Bun lockfile
└── docs/
    └── requirements/
        ├── FEAT-001-turn-based-code-relay/
        │   ├── requirements.md   # User stories, acceptance criteria (EARS)
        │   ├── design.md         # Approved tech decisions, architecture
        │   └── tasks.md          # Implementation task breakdown
        ├── FEAT-002-docker-compose-integration/
        │   ├── requirements.md   # Docker/compose requirements (EARS)
        │   ├── design.md         # Multi-stage, same-origin routing, Railway compatibility
        │   └── tasks.md          # 8 tasks: Dockerfiles, compose profiles, prod wiring
        └── FEAT-003-session-ux-completion/
            ├── requirements.md   # UI/UX gap audit + requirements (EARS)
            ├── design.md         # Turn scheduler, protocol additions, component plan
            └── tasks.md          # 13 tasks: timer, driver/rotation visibility, grace period UX
```

## Architecture

### Dev Stack

```
Host Machine
    ↓
    ├─→ nginx:8080 (reverse proxy)
    │       ├─→ /      → client:5173 (Vite dev server)
    │       └─→ /api,/ws → server:3000 (Hono HTTP + WebSocket)
    │
    ├─→ server:3000 (direct, for debugging)
    └─→ client:5173 (direct, for debugging)

All source code bind-mounted (live reload)
```

### Prod Stack

```
Host Machine
    ↓
    nginx-prod (serves static client + proxies API)
    ├─→ / (static files from Vite build)
    └─→ /api,/ws → server-prod (Hono HTTP + WebSocket)

No bind mounts, fully baked, stateless
```

## Key Concepts

### Ephemeral Sessions

No persistent accounts. Every session is:
- Time-bounded
- Identified by a room code + shareable link
- Scoped to session duration only (no history, no transcripts retained post-session)

### Real-Time Sync

- **Authority:** server holds the canonical document state + edit order
- **Collab:** client applies `@codemirror/collab` OT to send/receive updates
- **Convergence:** all clients converge on identical document via server-ordered updates
- **Presence:** transient cursors/selections broadcast separately, anchored via logical positions

### Roles

- **Host:** session admin, owns the host token, can be admin-only or participate as a Driver
- **Observer:** participant eligible for the Driver rotation
- **Spectator:** watch-only, never eligible to drive or edit
- **Driver:** current Observer/host+participant holding the edit token for the active turn

### Turn Engine

- **Fixed-duration:** turns end on timer expiry or host action
- **Early-end (optional):** driver can end their turn before timer if enabled
- **Selection:**
  - **Round-robin:** automatic, fair rotation; late joiners inserted fairly
  - **Manual pass:** host assigns next Driver each turn
- **Disconnect handling:** driver disconnect triggers grace period + host prompt (reassign/extend/skip)

## Development

### Running Tests

```bash
# All workspaces
bun test

# Specific workspace
bun --cwd packages/server test
bun --cwd packages/client test
```

### Type Checking

```bash
bun run typecheck
```

### Building (Client SPA)

```bash
bun run build:client
# Output: packages/client/dist/
```

## Deployment

This project is designed to be deployable on **Railway** (or similar container platforms):

1. Each Dockerfile is standalone-runnable (no Docker Compose assumptions)
2. Services are independent (no cross-service build-time dependencies)
3. Railway maps each Compose service to an individual Railway service

Future: add Railway deployment templates (`railway.json`, `railway.toml`).

## Future Roadmap

- **Persistent storage:** PostgreSQL (users, session metadata, saved code snapshots) + Redis (ephemeral session state, presence, pub/sub fanout)
- **In-browser execution:** WebAssembly/Web Worker sandbox, REPL, stateful runtime
- **Autocomplete & IntelliSense:** semantic code completion for supported languages
- **Gamification:** points, badges, streaks, leaderboards
- **Session transcripts:** optional post-session history/export (future feature, not in FEAT-001)
- **LAN/P2P transport:** local network fallback (designed for, not implemented)

## Contributing

See `docs/requirements/FEAT-001-turn-based-code-relay/` and `docs/requirements/FEAT-002-docker-compose-integration/` for detailed requirements, design decisions, and task breakdowns.

### For Reviewers: Bugfix Documentation

Fixes for UX/session-management gaps (own-cursor visibility, host admin controls, driver early-end, host disconnect indicator) are documented in `docs/bugfixes/`:

- `docs/bugfixes/INDEX.md` — navigation, summary table, test results, commit history
- `docs/bugfixes/BUGFIX-001-own-cursor-visibility.md` through `BUGFIX-004-host-disconnect-indicator.md` — per-fix root cause, solution, tests, requirements compliance
- `docs/bugfixes/HOST_UX_FLOW.md` — end-to-end walkthrough of the host experience (room creation → configuration → turn management → session end)

Use `docs/bugfixes/INDEX.md` as the entry point; it supersedes the root-level investigation/summary notes from the initial analysis pass.

## License

MIT (or your chosen license)

## Support

For issues, questions, or contributions, please open an issue or pull request on the repo.
