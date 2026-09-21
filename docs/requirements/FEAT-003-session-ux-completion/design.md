# FEAT-003 — Session UI/UX Completion — Design

**Status:** Proposed (pending review)
**Source requirements:** [`requirements.md`](./requirements.md)

## 1. Problem Statement

FEAT-001's server/shared domain model (`packages/shared/src/engine.ts`,
`domain.ts`) fully specifies turn timing, rotation order, and disconnect
grace-period behavior. However, the real running server
(`packages/server/src/ws.ts`) never schedules turn expiry, never broadcasts
rotation order or grace-period state, and the client
(`packages/client/src/components/`) never renders driver identity, turn
countdown, rotation order, or grace-period status — even where the server
already sends the data. This feature closes those gaps end-to-end: adding
the missing server-side scheduler and broadcasts where absent, and building
the client UI to consume both existing and newly-added broadcasts.

## 2. Requirements Coverage

| Group | Requirements |
|-------|--------------|
| Turn timer (end-to-end) | REQ-025, REQ-026, REQ-027 |
| Driver & turn visibility | REQ-028, REQ-029 |
| Driver selection UI | REQ-030, REQ-031 |
| Disconnect & grace period visibility | REQ-032, REQ-033, REQ-034 |
| Reconnection & role confirmation | REQ-035 |
| Control feedback & session teardown | REQ-036, REQ-037, REQ-038 |
| Non-functional | NFR-010..012 |

## 3. Approved Technology Decisions

No new runtime dependencies or infrastructure changes. This feature is built
entirely within the existing stack established by FEAT-001:

- **Server-side timer:** `setTimeout`/`clearTimeout` per active turn, held on
  the in-memory room record (mirrors how `RoomRegistry` already holds
  per-room mutable state — no new persistence, no external scheduler/queue).
  One timer per room with an active turn; cancelled and replaced on every
  turn transition (start, early-end, host-action-end, expiry).
- **Turn-tick broadcast cadence:** `setInterval` per room with an active
  turn, 1s cadence (per REQ-026.2), started when a turn starts and cleared
  when it ends. Piggybacks on the existing `server.publish(roomTopic(code),
  ...)` pub/sub path — no new transport.
- **Protocol additions:** purely additive members on the existing
  `ServerMessage`/`ClientMessage` discriminated unions in
  `packages/shared/src/protocol.ts` (NFR-012). No existing message shape is
  modified.
- **Client state:** extend the existing SolidJS signal-based state in
  `RoomEditor.tsx` (already tracks `sessionPhase`, `turnConfig`,
  `currentDriver`, `roster`) with new signals for `remainingMs`,
  `rotationOrder`, `disconnectState`, and transient rejection/session-ended
  banners. No new state management library.
- **Client UI:** extend `SessionControls.tsx` (existing host/driver control
  panel) rather than introducing a parallel component tree, since the new
  elements (timer, driver badge, rotation order, grace-period panel) are all
  session-status information that belongs alongside the existing "Session
  Status" section. A new `GracePeriodModal.tsx` component is introduced
  specifically for the host's reassign/extend/skip action set, since that
  is a distinct modal interaction, not a passive status readout.

## 4. Architecture

### 4.1 Server: Turn Scheduler

New module: `packages/server/src/turnScheduler.ts`

```typescript
export interface TurnTimers {
  expiryTimer: ReturnType<typeof setTimeout> | null;
  tickInterval: ReturnType<typeof setInterval> | null;
}

// Keyed by room code, held alongside RoomRegistry's existing per-room state.
// One TurnTimers record per room; created lazily on first turn start.
```

Responsibilities:
- `scheduleTurnExpiry(room, code, server, registry)` — called whenever a
  turn starts (`turnStarted` event applied). Sets a `setTimeout` for
  `turnConfig.durationMs`. On fire: applies a `turnEnded` event with reason
  `"expiry"` (engine-level guard, REQ-024, already exists per
  `Turn.ended`), advances to the next turn per selection policy, and
  broadcasts `TurnEndedMsg` + updated `SessionSnapshotMsg`.
- `startTurnTicks(room, code, server)` — called alongside expiry
  scheduling. Sets a `setInterval` at 1s, broadcasting `TimerTickMsg` with
  `remainingMs = max(0, startedAt + durationMs - Date.now())`.
- `cancelTurnTimers(code)` — called on early-end, host-action end, or room
  teardown. Clears both the expiry timeout and the tick interval
  (NFR-010). Idempotent (safe to call when no timers are active).

This module is called from `handleControlMessage`'s `startTurn`/`earlyEnd`
cases and from the room-registry's rotation-advance logic (wherever the
engine's round-robin auto-advance is triggered), plus from `endRoom()` for
cleanup on session end (REQ-025.4).

**Why a dedicated module and not inline in `ws.ts`:** `ws.ts` is
transport/dispatch logic; scheduling is a distinct concern with its own
lifecycle (create/cancel/replace) that benefits from isolated unit tests
against a fake clock, independent of WebSocket plumbing.

### 4.2 Protocol Additions

New `ServerMessage` variants in `packages/shared/src/protocol.ts` (all
`channel: "control"`, additive per NFR-012):

```typescript
/** Grace period started after a driver/host disconnect (REQ-032.1). */
export interface DisconnectGraceStartedMsg {
  readonly channel: "control";
  readonly type: "disconnectGraceStarted";
  readonly participantId: ParticipantId;
  readonly participantName: string;
  readonly role: Role;
  readonly gracePeriodMs: number;
  readonly startedAt: number;
}

/** Grace period resolved (REQ-032.2). */
export interface DisconnectGraceResolvedMsg {
  readonly channel: "control";
  readonly type: "disconnectGraceResolved";
  readonly resolution: "reconnected" | "reassigned" | "extended" | "skipped";
  readonly participantId: ParticipantId;
}

/** Rotation order snapshot (REQ-031.1). Sent alongside SessionSnapshotMsg
 *  whenever selectionPolicy is "round-robin" and rotation state changes. */
export interface RotationSnapshotMsg {
  readonly channel: "control";
  readonly type: "rotationSnapshot";
  readonly order: readonly ParticipantId[];
  readonly nextIndex: number;
}
```

Existing but previously-unused protocol types now wired to actual server
emission:
- `TimerTickMsg` — emitted by the new turn scheduler (§4.1).
- `RoleAssignedMsg` — emitted on join (`routes/rooms.ts` bootstrap path) and
  on reconnect (`ws.ts` `open` handler), per REQ-035.

New `ClientMessage` variant:

```typescript
/** Host resolves an active disconnect grace period (REQ-033.2). */
export interface ResolveGraceMsg {
  readonly channel: "control";
  readonly type: "resolveGrace";
  readonly action: "reassign" | "extend" | "skip";
  /** Required when action is "reassign". */
  readonly newDriver?: ParticipantId;
}
```

### 4.3 Server: Disconnect Grace Period Wiring

The engine already fully implements `DisconnectState` (REQ-020/022) via
verified reducer cases in `applyEvent`: `connectionChanged` (detects
driver/host disconnect and presumably sets `disconnectState`),
`gracePeriodElapsed` (applies the safe default when the grace period times
out), and `hostActionTaken` (applies the host's reassign/extend/skip
decision). **No new engine/reducer logic is required** — this is a pure
wiring task. The gap is entirely in `ws.ts` (nothing schedules a timer to
fire `gracePeriodElapsed`, and nothing broadcasts `DisconnectState` changes
to clients) and in the client (no UI consumes it). Implementation:
`turnScheduler.ts` starts a grace-period timer when `connectionChanged`
transitions the driver or host to disconnected (mirroring how it schedules
turn expiry); on timer fire, applies `gracePeriodElapsed` and broadcasts
`DisconnectGraceResolvedMsg`. On explicit host resolution
(`resolveGrace` message) or reconnect, cancels the timer, applies
`hostActionTaken` or the reconnect path, and broadcasts the resolution.

### 4.4 Client: New/Extended Components

- **`RoomEditor.tsx`** (extend): add signals `remainingMs`, `rotationOrder`,
  `graceState`, `controlError`, `sessionEnded`. Subscribe to the new/newly-
  wired message types in the existing `connection.onMessage()` handler.
- **`SessionControls.tsx`** (extend):
  - Countdown display (REQ-027) rendered in the existing "Session Status"
    block, driven by `remainingMs`, ticking client-side between server
    ticks for smoothness (server ticks at 1s per REQ-026.2; client may
    interpolate locally between ticks using a local `setInterval` reset on
    each server tick, avoiding drift without requiring sub-second server
    broadcasts).
  - Current-driver badge (REQ-028) and turn number (REQ-029).
  - Manual driver picker (REQ-030): rendered only when
    `selectionPolicy === "manual"` and the local user is host and eligible
    to start a turn; lists connected, non-spectator roster entries as
    selectable.
  - Rotation order list (REQ-031): rendered when `selectionPolicy ===
    "round-robin"`, showing order and highlighting the next-up driver.
  - Host-specific disconnected banner (REQ-034): computed from
    `roster.find(p => p.role === "host")`, rendered unconditionally at the
    top of the panel (not gated behind "Show Roster").
  - Transient control-rejection banner (REQ-036): short-lived (auto-dismiss
    after a few seconds, per REQ-036.3), triggered by
    `controlRejected` messages correlated to the local user's own actions.
- **New `GracePeriodModal.tsx`:** host-only modal shown while
  `graceState !== null`, with Reassign (opens a driver picker reusing the
  REQ-030 roster-selection UI), Extend, and Skip actions, each sending a
  `resolveGrace` message. All participants (not just host) see a
  non-modal, non-blocking countdown banner while `graceState !== null`
  (REQ-033.1); only the host sees the actionable modal (REQ-033.2).
- **Session-ended view (REQ-037):** `App.tsx` gains a `sessionEnded` case in
  its session-state handling, rendered as a distinct screen (not the live
  editor) with a "Return to lobby" action, replacing the current behavior
  of leaving the user in a frozen editor.

## 5. Data Flow — Turn Timer (Representative Sequence)

```
Host clicks "Configure & Start Session" (or startTurn for manual mode)
    ↓
Server: applyEvent(turnStarted) → room.session.currentTurn set
    ↓
Server: turnScheduler.scheduleTurnExpiry() + startTurnTicks()
    ↓ (every 1s)
Server: broadcast TimerTickMsg { remainingMs }
    ↓
Client: setRemainingMs(msg.remainingMs); local countdown interpolates between ticks
    ↓ (durationMs elapses, no early-end/host-action)
Server: expiryTimer fires → applyEvent(turnEnded, reason: "expiry")
    ↓
Server: turnScheduler.cancelTurnTimers() [clears this turn's timers]
    ↓
Server: advance to next turn per selection policy → applyEvent(turnStarted) for next driver
    ↓
Server: broadcast TurnEndedMsg + TurnStartedMsg + SessionSnapshotMsg
    ↓
Server: turnScheduler.scheduleTurnExpiry() + startTurnTicks() [for the new turn]
    ↓
Client: updates currentDriver, remainingMs resets, turn number increments
```

## 6. Testing Strategy

- **`turnScheduler.test.ts`** (new): unit tests using Bun's fake-timer
  support (or manual `Date.now()` injection if fake timers are unavailable
  in the Bun test runner) to verify: expiry fires exactly once at the
  correct delay, cancellation prevents a scheduled expiry from firing,
  replacing an active timer (new turn starts) doesn't leak the old one,
  tick broadcasts stop after cancellation.
- **`ws.test.ts` (extend):** integration-level tests verifying
  `TimerTickMsg`/`TurnEndedMsg(reason: "expiry")` are actually observed by a
  connected test client after a turn's duration elapses (using a short
  `durationMs` in test config to keep tests fast).
- **`engine.test.ts` (extend if needed):** confirm the reducer path for
  `turnEnded(reason: "expiry")` and grace-period resolution behaves per
  REQ-020/022/024 (may already be covered; verify during implementation).
- **Client component tests:** existing `presence.test.ts`-style unit tests
  for new signals/derived state in `RoomEditor.tsx` (e.g., countdown
  interpolation logic, rotation-order rendering, grace-period banner
  visibility conditions).
- **Manual/E2E:** extend `packages/server/src/e2e.test.ts`'s existing
  "full flow" tests to cover: a turn expiring naturally under fixed mode,
  a manual-mode driver pick, and a simulated driver disconnect triggering
  and resolving a grace period.

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Timer leaks across rapid turn transitions or room teardown | Centralize all scheduling in `turnScheduler.ts` with a single cancel-before-schedule invariant; add a test asserting no dangling timers after `endRoom()`. |
| Client countdown drifts from server truth between ticks | Client re-syncs to the authoritative `remainingMs` on every server tick (1s cadence); local interpolation is cosmetic only, never authoritative. |
| New protocol messages break older/cached clients during rollout | All additions are additive union members (NFR-012); older clients simply ignore unknown message types (existing `ServerMessage` handling in `RoomEditor.tsx` already switches on `msg.type` and falls through silently on unrecognized types — verify this during implementation and add a default/no-op branch if not already present). |
| Grace-period reducer logic in `engine.ts` may be incomplete | **Verified during audit:** `applyEvent` already implements `connectionChanged` (line 304), `gracePeriodElapsed` (line 458), and `hostActionTaken` (line 491) reducer cases. The pure engine logic is complete; the gap is purely in `ws.ts` (no scheduler ever calls `gracePeriodElapsed`) and the client (no UI consumes `DisconnectState`). Implementation only needs to wire the existing reducer into the new scheduler and protocol — no new engine reducer logic required. |
