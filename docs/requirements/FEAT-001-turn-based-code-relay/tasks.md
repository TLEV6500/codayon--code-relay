# FEAT-001 — Turn-Based Code Relay (Foundation Slice) — Tasks

**Status legend:** `[x]` complete · `[~]` in progress · `[ ]` not started
**Source:** [`requirements.md`](./requirements.md) · [`design.md`](./design.md)

Each task is a working, demoable increment, built test-first where applicable,
ending by wiring into the running app. No orphaned code.

---

- [x] **Task 1 — Monorepo & runtime bootstrap**
  - Bun workspaces with `packages/shared`, `packages/server` (Hono on
    `Bun.serve`), `packages/client` (Solid + Vite + Tailwind v4 via
    `@tailwindcss/vite`), shared strict TS config, `bun test` wired.
  - A trivial `shared` export imported by both server and client proves
    cross-package resolution.
  - **Requirements:** foundation (no direct REQ).
  - **Verified:** `bun test` 3/3 pass; typecheck clean; client builds with
    Tailwind CSS emitted; server `GET /health` returns 200 with protocol
    version.

- [x] **Task 2 — Protocol types + pure turn-engine skeleton in `shared`**
  - Wire message types (doc/presence/control) and a pure `SessionState` reducer
    for create → configure → start (no turns yet); role model
    (Host/Observer/Spectator, host-as-participant flag).
  - Encodes REQ-005/006 role rules and REQ-007 "no turn mode ⇒ cannot start"
    guard.
  - **Requirements:** REQ-005, REQ-006, REQ-007.
  - **Verified:** `bun test` 17/17 pass (14 new engine tests: create, role
    assignment, token eligibility, config guards, start guard); typecheck clean.

- [ ] **Task 3 — Room lifecycle over HTTP as Hono routes**
  - Create room (returns room code + link + ephemeral host token), join by code
    (participant vs spectator), fetch bootstrap doc+version. In-memory registry;
    invalid/ended room denied; reject partial init. CORS + validation + error
    middleware.
  - **Requirements:** REQ-001, REQ-002, REQ-003.
  - **Demo:** create a room, join from another client with the code, get a room
    + role; joining a bad code is rejected.

- [x] **Task 4 — WebSocket connect + authoritative document relay**
  - WS upgrade via `server.upgrade(req, { data })`; `open`/`message`/`close` on
    Bun's native handler; subscribe socket to room topic; `getDocument` /
    `pullUpdates` / `pushUpdates` collab authority in-memory; CM6
    `@codemirror/collab` peer on the client; broadcast via Bun native pub/sub.
    `rebaseUpdates` on version mismatch. (Any participant may push for now;
    token enforcement lands in Task 6.)
  - **Requirements:** REQ-016, REQ-017; NFR-001.
  - **Verified:** `bun test` 40/40 pass (RoomDoc authority incl. rebase +
    convergence; WS integration: unknown-token rejection, getDocument snapshot,
    push broadcast + convergence); typecheck clean; client builds; live
    entrypoint e2e (create → join → push → peer broadcast → converge to
    "hello world" @ v1).

- [ ] **Task 5 — Presence channel (cursors/selections)**
  - Broadcast cursor/selection as transient presence on a separate channel;
    render remote cursors/selections in CM6; remove on disconnect; shown to
    spectators too. Anchor via logical positions mapped through changes
    (foundation for REQ-015).
  - **Requirements:** REQ-018.
  - **Demo:** moving the cursor/selecting in one tab shows a labeled remote
    cursor in the others, including a spectator tab.

- [ ] **Task 6 — Edit token & server-side read-only enforcement**
  - Edit token in session state (exactly one holder); server rejects
    `pushUpdates` from non-holders and any spectator mutation; client editor
    toggles read-only from token. Enforced server-side, not client-only.
  - **Requirements:** REQ-012, REQ-013, REQ-014; NFR-005.
  - **Demo:** only the token holder can type; other tabs read-only; a
    spectator's forced push is rejected and the document is unchanged.

- [ ] **Task 7 — Turn engine: start/advance, timer, early-end (manual pass first)**
  - Start grants token + starts timer; end on expiry/host action; manual-pass
    selection (host assigns next driver). Broadcast `turnStarted`/`turnEnded`,
    `timerTick`, token grant/revoke. Single turn-end resolution guarding the
    early-end vs expiry race. Early-end only in the early-end mode.
  - **Requirements:** REQ-007, REQ-009, REQ-010, REQ-012.3, REQ-024.
  - **Demo:** host starts a session, sees a live countdown across tabs, passes
    control manually; token + read-only state move to the next driver on
    expiry/early-end.

- [ ] **Task 8 — Round-robin selection with fair late-comer recalculation**
  - Deterministic rotation over eligible participants; late Observers inserted
    fairly (not ahead of those who haven't driven this cycle); leavers removed
    without stalling; recompute without interrupting the active turn.
    Host+participant included per creation choice; spectators excluded.
  - **Requirements:** REQ-008, REQ-011, REQ-025.
  - **Demo:** with round-robin, control auto-advances in order; a tab joining
    mid-session as participant lands fairly in the queue and eventually drives
    without jumping ahead.

- [ ] **Task 9 — Drift-free token handoff (logical anchoring)**
  - Cursors/selections keep logical positions across handoffs and surrounding
    edits; all clients converge on identical content at handoff completion. Map
    presence anchors through `ChangeSet`.
  - **Requirements:** REQ-015 (verified against REQ-017).
  - **Demo:** during a handoff with edits near an observer's cursor, that cursor
    stays at the right logical spot and all tabs show identical content.

- [ ] **Task 10 — Disconnect handling: driver grace period + host prompt + safe defaults**
  - On driver disconnect during a turn: pause timer, hold token for a grace
    period, prompt Host (reassign/extend/skip). Reconnect within grace (no host
    action) restores token + resumes timer. Grace elapse: round-robin
    auto-advances; manual pass stays paused until host acts. Handle
    host+participant driver disconnect and host-token binding retention.
  - **Requirements:** REQ-020, REQ-022.
  - **Demo:** kill the driver tab mid-turn: timer pauses, host sees a prompt;
    reconnect restores control; letting grace elapse advances (round-robin) or
    holds (manual).

- [ ] **Task 11 — Non-driver disconnect/rejoin + reconnection resync**
  - Observer/Spectator disconnects don't interrupt the turn; presence removed;
    rotation skips absent observers. On rejoin, resync to authoritative
    doc+version, restore role/eligibility/read-only, lose no accepted edit.
  - **Requirements:** REQ-021, REQ-023; NFR-002.
  - **Demo:** an observer drops and rejoins mid-turn; the turn never stalls and
    the returning tab converges with everyone with correct role and read-only
    state.

- [ ] **Task 12 — Ephemeral teardown + host authorization hardening**
  - End session (host action or terminating condition): transition to ended,
    revoke eligibility, purge doc/turn history/presence/participants/room code,
    reject subsequent joins/actions; all admin actions require host token;
    invalidate host token and ephemeral IDs on end.
  - **Requirements:** REQ-004, REQ-005 (full), REQ-003.3; NFR-005.2.
  - **Demo:** host ends the session; all tabs see it end, the room code no
    longer joins, and a non-host attempting admin actions is refused throughout.

- [ ] **Task 13 — Editor polish: syntax highlighting set, extensibility, mobile responsiveness**
  - CM6 language support for TypeScript, JavaScript, Bash, PowerShell, HTML,
    CSS, Python, SQL, JSON, YAML, TOML via a language registry that adds
    languages without touching relay/turn engine; responsive editor canvas with
    Tailwind; no autocomplete/execution.
  - **Requirements:** REQ-019; NFR-003, NFR-004.
  - **Demo:** switch document language and see highlighting for the listed
    languages; the editor is usable/readable on a narrow mobile viewport.

- [ ] **Task 14 — End-to-end integration pass + latency/convergence validation**
  - Full-flow across two+ simulated clients: create → join → configure → run
    turns (both policies) → disconnect/reconnect → early-end/expiry race → end.
    Lightweight latency/convergence harness targeting NFR-001 (edit & presence
    p95 < 250 ms locally) and NFR-002 convergence.
  - **Requirements:** integration of all; NFR-001, NFR-002.
  - **Demo:** a single command runs the end-to-end scenario green, printing
    propagation timings within target and confirming all clients converged.
