# Codayon — Turn-Based Code Relay Platform

Codayon is a gamified, turn-based collaborative code relay platform for educational workshops, mentorship, and team-building coding relays. Participants take timed turns driving a shared code editor while others watch live with real-time presence (cursors, selections). One person types at a time; control passes predictably via round-robin rotation or host-controlled manual pass.

## Status at a Glance

| Feature | Status | Notes |
|---|---|---|
| FEAT-001 — Turn-based relay foundation | ✅ Complete | Core editor, turn engine, roles, presence |
| FEAT-002 — Docker Compose integration | ✅ Complete | Dev + prod profiles, same-origin nginx routing |
| FEAT-003 — Session UI/UX completion | ✅ Complete (13/13 tasks) | All server-modeled capabilities now surfaced in the client UI |
| FEAT-004 — E2E UI testing (Bun WebView) | ✅ Implemented, ⚠️ known intermittent flakiness | See [Test Status](#test-status) |
| Known gaps (documented, not yet fixed) | 📝 Documented via failing/passing tests | Duplicate names, host-disconnect broadcast, host-rejoin — see [Known Gaps](#known-gaps-documented-not-yet-fixed) |
| Persistent storage, in-browser execution, autocomplete, gamification | ⛔ Not built | See [Future Roadmap](#future-roadmap) |

## Features

### FEAT-001: Turn-Based Code Relay Foundation ✅

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
- **Monorepo:** Bun workspaces (`packages/server`, `packages/client`, `packages/shared`, `packages/e2e`)

See `docs/requirements/FEAT-001-turn-based-code-relay/` for requirements, design, and tasks.

### FEAT-002: Docker Compose Integration ✅

Production-ready containerization with dev/prod orchestration:

- **Two Compose profiles:**
  - **`dev`** — bind-mounted source, live reload, Bun `--hot`, Vite file watcher, nginx same-origin reverse proxy
  - **`prod`** — fully baked multi-stage images, static client build, minimal footprint, no dev tooling
- **Same-origin routing** — nginx reverse proxy unifies client (`/`) and server (`/api`, `/ws`) under one origin, avoiding CORS/mixed-origin WebSocket issues
- **WebSocket support** — full upgrade header forwarding for real-time relay in both dev and prod
- **Multi-stage builds** — server prod image significantly smaller than dev, no dev dependencies
- **Railway-compatible** — each Dockerfile runs standalone; services deployable as individual Railway services later
- **Configurable** — `.env.example` with port/env var defaults, `.env` (gitignored) for overrides

See `docs/requirements/FEAT-002-docker-compose-integration/` for requirements, design, and tasks.

### FEAT-003: Session UI/UX Completion ✅

All 13 tasks complete. Closed the gaps between server-modeled capabilities and the client UI — features that were already implemented in the turn engine/protocol but never surfaced to users:

- **Turn timer end-to-end** — server-side scheduler auto-expires fixed-duration turns and broadcasts a live countdown
- **Driver & turn visibility** — current driver name and turn number shown to all participants
- **Manual driver assignment UI** — host picker to choose the next driver by name (manual selection policy)
- **Rotation order visibility** — round-robin order and "who's up next" shown to all participants
- **Disconnect grace period UX** — visible countdown for all users + host reassign/extend/skip actions when a driver disconnects mid-turn (`GracePeriodModal.tsx`)
- **Host-specific disconnect indicator** — distinct, always-visible signal when the host (not just any participant) disconnects
- **Role assignment confirmation** — server-confirmed role delivered on join/reconnect, UI reflects it reactively (not a stale initial prop)
- **Control rejection & session-ended feedback** — clear, human-readable feedback instead of silent failures or a frozen editor (`SessionEnded.tsx`)

See `docs/requirements/FEAT-003-session-ux-completion/` for the full gap audit, requirements, design, and the task-by-task completion record.

### FEAT-004: End-to-End UI Testing with Bun WebView ✅

Render-level e2e tests that drive a real browser against a real server + client, catching component-mounting bugs that unit tests cannot:

- **Motivation:** FEAT-003 shipped with two defects where state was tracked but never wired into rendered UI (non-reactive signals, stale props). Unit tests and server-side integration tests passed, but users saw nothing rendered.
- **Solution:** Real browser assertions on actual DOM via `Bun.WebView` + Chrome backend
- **Coverage:** All FEAT-003 UI surfaces (SessionControls, turn timer, driver visibility, rotation order, grace period, host-disconnect indicator, control rejection, session-ended view, early-end affordance)
- **Architecture:** Ephemeral server + static client on port 0, multi-view scenarios, same-origin routing via a custom harness (real Bun native WebSocket proxying, not `fetch()`-based forwarding)
- **URL-based auto-join:** the client parses `/room/{code}?clientToken={token}` on load and auto-joins — this was the original blocker for most e2e tests (see `docs/bugfixes/BUGFIX-006-url-based-room-autojoin.md`) and is now implemented in `App.tsx`

See `docs/requirements/FEAT-004-e2e-ui-testing/` for requirements, design, and tasks. See [Test Status](#test-status) below for current pass rates and known flakiness.

## Known Gaps (Documented, Not Yet Fixed)

Three gaps were found in a follow-up audit after FEAT-003/FEAT-004 shipped. By explicit decision, this pass only added **tests that document current behavior** — no production code was changed. Full root-cause analysis: `docs/bugfixes/GAPS-duplicate-names-host-disconnect-rejoin.md`.

| Gap | Type | Current Behavior | Proven By |
|---|---|---|---|
| **Duplicate names** | Missing validation | Any number of participants (including a rejoining participant) can share an identical display name on the roster — no uniqueness check anywhere in the stack | `packages/shared/src/engine.duplicate-names.test.ts`, `packages/server/src/rooms.duplicate-names.test.ts` (tests **pass** — they document the permissive behavior) |
| **Host-disconnect broadcast** | Real bug | When the host (or any non-driving participant) disconnects, `ws.ts`'s close handler updates internal state but never broadcasts it — other clients' rosters and the host-disconnect indicator go stale until an unrelated action happens to trigger a broadcast | `packages/server/src/ws.host-disconnect-broadcast.test.ts`, `packages/e2e/src/host-disconnect-live-update.test.ts` (tests **fail/timeout** — this is a real defect) |
| **Host rejoin** | Missing feature | If a host loses their session (closed tab, cleared storage, new device), there is no way back in as host — the lobby only offers "Join as participant" (observer) or "Spectate"; no endpoint accepts the secret `hostToken` to remint a host session | `packages/client/src/App.test.ts` (`describe("Host rejoin gap (undocumented feature)")`) (tests **pass** — they document the absence) |

None of these are blocking for the MVP relay flow (create → configure → run turns → end session all work correctly for a single host who stays connected), but they should be addressed before running unattended or high-churn sessions.

## Quick Start

### Prerequisites

- **Bun 1.4+** ([install](https://bun.sh))
- **Docker + Docker Compose** ([install](https://docs.docker.com/compose/install/)) — only needed for the containerized workflow
- **Chrome/Chromium/Edge/Brave** — only needed to run the e2e test suite (`bun run test:e2e`)

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
│   ├── server/               # Hono HTTP + Bun native WebSocket relay
│   │   └── src/
│   │       ├── index.ts              # Bun.serve entrypoint
│   │       ├── app.ts                # Hono app wiring (createApp/createAppWithDeps)
│   │       ├── ws.ts                 # WebSocket handler: doc/presence/control channels,
│   │       │                         #   turn control, grace period, session broadcasts
│   │       ├── relay.ts              # RoomDoc authority (OT reconciliation)
│   │       ├── rooms.ts              # RoomRegistry: create/join/bootstrap, host tokens
│   │       ├── turnScheduler.ts      # Per-room turn-expiry + tick + grace-period timers
│   │       ├── test-exports.ts       # Re-exports for e2e harness consumption
│   │       └── routes/rooms.ts       # HTTP room lifecycle endpoints (create/join/bootstrap)
│   ├── client/                # SolidJS + Vite + Tailwind + CodeMirror
│   │   ├── src/
│   │   │   ├── main.tsx              # Entry point
│   │   │   ├── App.tsx               # Lobby + URL auto-join + session view
│   │   │   ├── api.ts                # HTTP client (createRoom/joinRoom/bootstrapRoom)
│   │   │   ├── collab/
│   │   │   │   ├── transport.ts      # Typed WebSocket wrapper (RelayConnection)
│   │   │   │   ├── peer.ts           # CodeMirror collab peer extension
│   │   │   │   ├── presence.ts       # Remote cursor/selection rendering
│   │   │   │   └── languages.ts      # Language-mode registry for the editor
│   │   │   └── components/
│   │   │       ├── RoomEditor.tsx    # Editor mount, session state, control-channel subscriptions
│   │   │       ├── SessionControls.tsx  # Host/driver controls, roster, countdown, all FEAT-003 UI
│   │   │       ├── GracePeriodModal.tsx # Host-only reassign/extend/skip modal
│   │   │       └── SessionEnded.tsx     # Session-ended teardown screen
│   │   └── vite.config.ts            # Vite config (dev proxy configurable)
│   ├── e2e/                   # End-to-end UI tests (Bun.WebView)
│   │   └── src/
│   │       ├── harness.ts                    # Server + client on ephemeral ports,
│   │       │                                 #   real WebSocket proxying (not fetch()-based)
│   │       ├── selectors.ts                  # Centralized data-testid selectors
│   │       ├── test-helpers.ts                # waitForSelector/waitForEvaluate polling helpers
│   │       ├── connection.test.ts            # REQ-042 (SessionControls mounts)
│   │       ├── role-confirmation.test.ts     # REQ-043 (role-gated UI)
│   │       ├── turn-timer.test.ts            # REQ-044 (countdown renders)
│   │       ├── driver-visibility.test.ts     # REQ-045 (driver name consistency)
│   │       ├── manual-driver-picker.test.ts  # REQ-046 (picker conditions)
│   │       ├── rotation-order.test.ts        # REQ-047 (late-joiner insertion)
│   │       ├── grace-period.test.ts          # REQ-048 (grace period UX)
│   │       ├── host-disconnect.test.ts       # REQ-049 (disconnect indicator)
│   │       ├── control-rejection.test.ts     # REQ-050 (rejection banner)
│   │       ├── session-ended.test.ts         # REQ-051 (ended view)
│   │       ├── early-end-affordance.test.ts  # REQ-052 (early-end button)
│   │       └── host-disconnect-live-update.test.ts # GAP: proves host-disconnect broadcast bug (expected to fail)
│   └── shared/                # Protocol types + turn engine (pure logic)
│       └── src/
│           ├── protocol.ts           # Wire message types (ClientMessage/ServerMessage)
│           ├── domain.ts             # Core domain types (Role, TurnConfig, SessionState, etc.)
│           ├── engine.ts             # Turn state machine (createSession/applyEvent)
│           └── index.ts              # Package entrypoint
├── docker/                    # Container configs
│   ├── server/Dockerfile             # Multi-stage: dev + prod targets
│   ├── client/Dockerfile             # Multi-stage: dev + build + prod targets
│   └── nginx/
│       ├── Dockerfile                # Prod-only nginx image
│       ├── nginx.conf                # Shared routing config
│       ├── root.dev.conf             # Dev variant (proxy to Vite)
│       ├── root.prod.conf            # Prod variant (static files + SPA fallback)
│       └── entrypoint.sh             # Profile selection + hostname substitution
├── docker-compose.yml                # Dev + prod profiles
├── .env.example                      # Configurable env vars (ports, etc.)
├── package.json                      # Root monorepo workspace config
├── bun.lock                          # Bun lockfile
└── docs/
    ├── requirements/
    │   ├── FEAT-001-turn-based-code-relay/     # requirements.md, design.md, tasks.md
    │   ├── FEAT-002-docker-compose-integration/ # requirements.md, design.md, tasks.md
    │   ├── FEAT-003-session-ux-completion/      # requirements.md, design.md, tasks.md (13/13 done)
    │   └── FEAT-004-e2e-ui-testing/              # requirements.md, design.md, tasks.md (15/15 done)
    └── bugfixes/
        ├── INDEX.md                              # Navigation, summary table, commit history
        ├── BUGFIX-001-own-cursor-visibility.md
        ├── BUGFIX-002-missing-host-controls.md
        ├── BUGFIX-003-driver-early-end.md
        ├── BUGFIX-004-host-disconnect-indicator.md
        ├── BUGFIX-005-nginx-crlf-entrypoint-crash.md
        ├── BUGFIX-006-url-based-room-autojoin.md
        ├── BUGFIX-007-e2e-test-timing-and-reliability.md
        ├── GAPS-duplicate-names-host-disconnect-rejoin.md # duplicate names, disconnect broadcast, host-rejoin
        └── HOST_UX_FLOW.md                       # End-to-end host experience walkthrough
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
- Identified by a room code + shareable link (`/room/{code}?clientToken={token}`, auto-joins on load)
- Scoped to session duration only (no history, no transcripts retained post-session; `RoomRegistry.endRoom()` purges all in-memory state when a session ends)

### Real-Time Sync

- **Authority:** server holds the canonical document state + edit order (`RoomDoc` in `relay.ts`)
- **Collab:** client applies `@codemirror/collab` OT to send/receive updates
- **Convergence:** all clients converge on identical document via server-ordered updates
- **Presence:** transient cursors/selections broadcast separately, anchored via logical positions

### Roles

- **Host:** session admin, owns the secret host token, can be admin-only or participate as a Driver (`hostParticipation: "admin-only" | "host-participant"`)
- **Observer:** participant eligible for the Driver rotation
- **Spectator:** watch-only, never eligible to drive or edit
- **Driver:** current Observer/host-participant holding the edit token for the active turn

Identity is ephemeral, session-scoped, and keyed by an opaque generated `ParticipantId` — display names are never checked for uniqueness (see [Known Gaps](#known-gaps-documented-not-yet-fixed)).

### Turn Engine

- **Fixed-duration:** turns end on timer expiry or host action
- **Early-end (optional):** driver can end their turn before timer if enabled
- **Selection:**
  - **Round-robin:** automatic, fair rotation; late joiners inserted fairly
  - **Manual pass:** host assigns next Driver each turn via a picker UI
- **Disconnect handling:** driver disconnect triggers a 30s grace period + host prompt (reassign/extend/skip); non-driver disconnects (e.g. host, when not driving) update internal state but are **not currently broadcast** to other clients in real time (see [Known Gaps](#known-gaps-documented-not-yet-fixed))

## Development

### Running Tests

```bash
# All workspaces (unit + integration + e2e — see caveat below)
bun test

# Specific workspace
bun --cwd packages/server test
bun --cwd packages/client test
bun --cwd packages/shared test
```

> **Note:** bare `bun test` (no path argument) picks up **every** `*.test.ts` file across all workspaces, including `packages/e2e`. There is no automatic isolation between the fast unit/integration suite and the browser-driven e2e suite — if you want only the fast suite, target specific workspaces (`bun --cwd packages/server test`, etc.) or specific paths, and use `bun run test:e2e` / `bun test packages/e2e` when you specifically want the browser-driven suite.

### Test Status

Running `bun test` (everything) typically reports around:

```
~405-407 pass
  3-5 fail
Ran 410 tests across 38 files
```

The failures break down as:
- **2 always-intentional** — `packages/server/src/ws.host-disconnect-broadcast.test.ts` and `packages/e2e/src/host-disconnect-live-update.test.ts` are gap-documentation tests that are *expected* to fail on every run; they prove the host-disconnect-broadcast bug described in [Known Gaps](#known-gaps-documented-not-yet-fixed). See `docs/bugfixes/GAPS-duplicate-names-host-disconnect-rejoin.md`.
- **0-3 intermittently flaky** — one or more multi-view e2e tests (commonly `rotation-order.test.ts`, `grace-period.test.ts`, or `driver-visibility.test.ts`) occasionally fail due to an intermittent Bun WebView connection-establishment race when a browser instance opens two concurrent views in quick succession. This is a test-harness timing issue, not an application bug — see `docs/bugfixes/BUGFIX-007-e2e-test-timing-and-reliability.md`. Re-running usually reduces (but does not always eliminate) this count; which specific test(s) trip varies per run.

Running `bun run test:e2e` in isolation typically shows ~22-23 out of 24 passing, with the same 2 intentional + 0-2 flaky failure pattern.

### End-to-End UI Tests (FEAT-004)

The project includes render-level e2e tests using `Bun.WebView` to verify FEAT-003 UI surfaces are actually rendered in a real browser. These tests boot a real server + client and assert on the actual DOM, catching bugs (like non-reactive signals) that unit tests cannot.

#### Browser Dependency (Chrome/Chromium)

E2E tests require a Chrome-family browser (Chrome, Chromium, Edge, Brave). `Bun.WebView` uses the `"chrome"` backend on Linux/Windows.

**If Chrome is not installed:**

On Linux (Debian/Ubuntu):
```bash
sudo apt-get install chromium-browser
# or
sudo apt-get install google-chrome-stable
```

On macOS:
```bash
brew install chromium
```

On Windows:
- Download [Chromium](https://download-chromium.appspot.com/) or [Google Chrome](https://www.google.com/chrome/)
- Or install via `choco install chromium` (if you use Chocolatey)

**Alternatively, set the Chrome path:**
```bash
export BUN_CHROME_PATH=/path/to/chrome
```

#### Running E2E Tests

```bash
# Run all e2e tests in packages/e2e
bun run test:e2e

# Or directly
bun test packages/e2e
```

E2E tests gracefully skip when Chrome is unavailable, with a clear message: "Chrome/Chromium not found. Install Chrome or set BUN_CHROME_PATH."

Before running e2e tests, the client must be built (`bun run build:client`) — the harness serves static files from `packages/client/dist`.

#### Test Structure

- **Harness** (`packages/e2e/src/harness.ts`): boots a real server + a static-file/WebSocket-proxying client server on ephemeral ports per test, with same-origin routing. Proxies `/ws` via a genuine Bun native WebSocket connection to the real server (not `fetch()`, which cannot perform a protocol upgrade).
- **Selectors** (`packages/e2e/src/selectors.ts`): centralized `data-testid` strings for DOM queries
- **Test helpers** (`packages/e2e/src/test-helpers.ts`): `waitForSelector`/`waitForEvaluate` polling helpers — all `WebView.evaluate()` calls use the IIFE pattern (`(() => ...)()`), since plain arrow-function strings are never invoked by the WebView bridge
- **Test files**: one per FEAT-003 requirement (connection, role-confirmation, turn-timer, driver-visibility, manual-driver-picker, rotation-order, grace-period, host-disconnect, control-rejection, session-ended, early-end-affordance), plus `host-disconnect-live-update.test.ts` documenting the known gap

#### Coverage

Render-level tests verify that the FEAT-003 UI surfaces are actually mounted and updated correctly:

- **REQ-042** — SessionControls mounts once relay connects (regression test for non-reactive signal bug)
- **REQ-043** — Role-gated UI reflects server-confirmed role (regression test for stale prop bug)
- **REQ-044** — Turn countdown visible and live
- **REQ-045** — Driver name and turn number consistent across views
- **REQ-046** — Manual driver picker appears under correct conditions
- **REQ-047** — Rotation order list reflects fair late-joiner insertion
- **REQ-048** — Grace period banner + host-only modal
- **REQ-049** — Host-disconnect indicator
- **REQ-050** — Control rejection banner with auto-dismiss
- **REQ-051** — Session-ended screen
- **REQ-052** — Early-end button disabled/enabled state

### Type Checking

```bash
bun run typecheck
```

Runs `tsc` across `packages/shared`, `packages/server`, `packages/client`, and `packages/e2e`.

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

Nothing in this section has been started — these are intentionally out of scope for FEAT-001 through FEAT-004:

- **Persistent storage:** PostgreSQL (users, session metadata, saved code snapshots) + Redis (ephemeral session state, presence, pub/sub fanout)
- **In-browser execution:** WebAssembly/Web Worker sandbox, REPL, stateful runtime
- **Autocomplete & IntelliSense:** semantic code completion for supported languages
- **Gamification:** points, badges, streaks, leaderboards
- **Session transcripts:** optional post-session history/export
- **LAN/P2P transport:** local network fallback (designed for, not implemented)
- **Fixes for the [Known Gaps](#known-gaps-documented-not-yet-fixed):** duplicate-name detection/disambiguation, host-disconnect real-time broadcast, host-rejoin endpoint + UI

## Contributing

See `docs/requirements/FEAT-001-turn-based-code-relay/` through `docs/requirements/FEAT-004-e2e-ui-testing/` for detailed requirements, design decisions, and task breakdowns for each shipped feature.

### For Reviewers: Bugfix & Gap Documentation

Fixes and known gaps are documented in `docs/bugfixes/`:

- `docs/bugfixes/INDEX.md` — navigation, summary table, test results, commit history. **Start here.**
- `docs/bugfixes/BUGFIX-001` through `BUGFIX-005` — UX/session-management fixes (own-cursor visibility, host admin controls, driver early-end, host disconnect indicator baseline, nginx CRLF crash)
- `docs/bugfixes/BUGFIX-006-url-based-room-autojoin.md` / `BUGFIX-007-e2e-test-timing-and-reliability.md` — the URL auto-join feature and e2e timing fixes that unblocked most of FEAT-004's test suite
- `docs/bugfixes/GAPS-duplicate-names-host-disconnect-rejoin.md` — the three currently-known, currently-unfixed gaps (see [Known Gaps](#known-gaps-documented-not-yet-fixed) above)
- `docs/bugfixes/HOST_UX_FLOW.md` — end-to-end walkthrough of the host experience (room creation → configuration → turn management → session end)

## License

MIT (or your chosen license)

## Support

For issues, questions, or contributions, please open an issue or pull request on the repo.
