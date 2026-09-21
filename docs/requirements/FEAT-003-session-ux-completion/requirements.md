# FEAT-003 — Session UI/UX Completion (Turn Timer, Roster & Connection Visibility)

## 1. Introduction

### 1.1 Product Context

FEAT-001 delivered the collaboration and turn-based relay backbone: an
authoritative session state machine (`packages/shared/src/engine.ts`), a
wire protocol (`packages/shared/src/protocol.ts`), and a WebSocket relay
(`packages/server/src/ws.ts`). A follow-up UX pass (branch
`fix/ux-actions-and-presence`, see `docs/bugfixes/BUGFIX-001` through
`BUGFIX-004`) added the first layer of client UI on top of that backbone:
own-cursor visibility, a host control panel (configure/start/end session),
a driver early-end button, and a basic roster list with per-participant
connected/disconnected dots.

An audit of the server/shared domain model against the actual client UI
(`packages/client/src/App.tsx`, `RoomEditor.tsx`, `SessionControls.tsx`)
found that several **product capabilities are fully modeled and partially
wired on the server, but have no corresponding client UI at all** — and, in
one case, **no server-side runtime implementation either**, despite being
defined in the wire protocol and covered by FEAT-001's requirements. This
document (FEAT-003) closes those gaps as a dedicated feature slice, rather
than bundling them as ad-hoc bugfixes, because they represent net-new UI/UX
surface area, not regressions from previously working behavior.

This document is **implementation-agnostic** where practical; acceptance
criteria are written in EARS style (WHEN/IF … THE SYSTEM SHALL …), following
the convention of FEAT-001/FEAT-002.

### 1.2 Audit Findings (Gap Inventory)

The following gaps were identified by cross-referencing
`packages/shared/src/domain.ts` / `engine.ts` (authoritative session model),
`packages/shared/src/protocol.ts` (wire messages), `packages/server/src/ws.ts`
(what the server actually sends), and the client components (what is actually
rendered):

| # | Capability | Server/Shared Status | Client Status | Gap Type |
|---|------------|----------------------|----------------|----------|
| G1 | Turn countdown timer | Not implemented — no `setInterval`/scheduler anywhere in `ws.ts`; `TimerTickMsg` defined in protocol but never constructed/sent | No timer UI | **End-to-end gap** (server logic + client UI both missing) |
| G2 | Fixed-duration turn auto-expiry | Not implemented — turns only end via explicit `earlyEnd` or host `startTurn` (manual); engine's reducer likely supports an `expiry` reason (per `TurnEndedMsg.reason` union) but nothing calls it on a timer | N/A (depends on G1) | **End-to-end gap** (violates FEAT-001 REQ-007/009 "fixed-duration turns end on timer expiry") |
| G3 | Current driver identity display | `SessionSnapshotMsg`/`TurnStartedMsg` carry driver id/name; `RoomEditor.tsx` tracks `currentDriver` in a signal but never renders it anywhere in the UI | Signal exists, unused in render | **Client gap** |
| G4 | Turn number / turn progress | `Turn.number` tracked server-side (`domain.ts`); never sent in any broadcast payload beyond `TurnStartedMsg.turnNumber` (which client ignores) | Not rendered | **Client gap** |
| G5 | Manual driver assignment UI (host picks next driver) | `StartTurnMsg` protocol + server `startTurn` handler both exist and work | No UI — host has no way to pick a specific driver from the roster; only automatic paths are wired in `SessionControls.tsx` | **Client gap** |
| G6 | Round-robin rotation visibility (who's next) | `RotationState` (`order`, `nextIndex`, `hasDrivenInCycle`) fully modeled server-side | Never sent to client at all, never rendered | **End-to-end gap** (not even in `SessionSnapshotMsg`) |
| G7 | Driver disconnect grace period UI | `DisconnectState` fully modeled server-side (REQ-020/022); no protocol message exists to broadcast it; no client UI | Not sent, not rendered | **End-to-end gap** |
| G8 | Host disconnect visual indicator | Roster shows connected/disconnected generically; no distinct treatment for the host role specifically | Generic roster dot only | **Client gap** (originally miscategorized as BUGFIX-004; reclassified here — see `docs/bugfixes/BUGFIX-004-host-disconnect-indicator.md`) |
| G9 | `RoleAssignedMsg` (role/host-participation confirmation on join/reconnect) | Defined in protocol (REQ-002.3, REQ-023.2); never constructed/sent by server | N/A | **End-to-end gap** |
| G10 | Control-action rejection feedback | `ControlRejectedMsg` is sent by the server on auth/state failures | Client never subscribes/displays it — rejected actions fail silently from the user's point of view | **Client gap** |
| G11 | Session-ended teardown UX | `SessionEndedMsg` protocol type exists; `endSession` handler causes `registry.endRoom()` server-side | Client has no handler for `sessionEnded`; user is left in a dead room with no explanation | **Client gap** |
| G12 | Early-end / mode ineligibility feedback | Driver sees the early-end button only when eligible; if they are not the driver or mode doesn't allow it, no explanation is given anywhere in the UI | No affordance | **Client gap** |

### 1.3 In Scope

- **Turn timer end-to-end**: server-side scheduler that ticks down active
  turns and auto-expires them on `fixed`/`fixed-early-end` mode timeout;
  `TimerTickMsg` broadcast; client countdown display (G1, G2).
- **Current driver + turn progress display**: visible "who's driving" and
  turn-number indicator for all participants (G3, G4).
- **Manual driver assignment UI**: host-facing picker to choose the next
  driver from the roster when `selectionPolicy: "manual"` (G5).
- **Round-robin rotation visibility**: broadcast and display of rotation
  order / "who's up next" (G6).
- **Driver disconnect grace period UI**: new protocol message(s) to
  broadcast grace-period activation/expiry; host-facing action UI
  (reassign / extend / skip) and passive countdown for all participants (G7).
- **Host-specific disconnect indicator**: visually distinct treatment (not
  just a generic roster dot) when the host disconnects (G8).
- **Role/reconnect confirmation wiring**: server sends `RoleAssignedMsg` on
  join and reconnect; client uses it to confirm/restore local role state (G9).
- **Control rejection UX**: client subscribes to `controlRejected` and
  surfaces a transient, human-readable error to the acting user (G10).
- **Session-ended teardown UX**: client subscribes to `sessionEnded` and
  transitions the user to a clear "session has ended" state instead of a
  dead/frozen editor (G11).
- **Early-end ineligibility affordance**: a non-driver or a driver in a mode
  that disallows early-end sees a disabled/explained state rather than the
  button simply not existing (G12).

### 1.4 Out of Scope (deferred to future specifications)

- **Session auto-cleanup on zero-connected participants** (tracked separately
  as `docs/bugfixes/BUGFIX-006`, deferred — orthogonal server-hygiene
  concern, not a UI/UX gap).
- **Connection history / activity log** (join/leave audit trail) — a "nice
  to have" enhancement noted in `BUGFIX-004`'s future-enhancements list, not
  required for core UX completeness.
- **Toast/notification system generalized beyond this feature's specific
  needs** (e.g., a full app-wide notification framework). This feature only
  requires the minimum surfacing needed for G7/G10/G11; a general-purpose
  notification system is not mandated.
- **Any new turn modes, role types, or session lifecycle states** beyond
  what FEAT-001 already defines. This feature is strictly a UI/UX
  completion pass over existing, already-specified server behavior — no new
  domain concepts are introduced except where explicitly noted (e.g., the
  new grace-period broadcast messages in REQ-032).
- **Mobile-specific layouts / responsive redesign** beyond what's needed to
  reasonably fit the new UI elements (timer, driver badge, grace-period
  modal) into the existing layout.

---

## 2. Glossary Additions

| Term | Definition |
|------|------------|
| **Grace period** | The bounded time window (server-tracked via `DisconnectState`) after a driver or host disconnects, during which the session waits before applying a safe default (per REQ-020/022), giving the disconnected user a chance to reconnect. |
| **Rotation order** | The deterministic, fairness-preserving sequence (`RotationState.order`) in which eligible participants take driver turns under round-robin selection. |
| **Turn tick** | A periodic server-emitted update (`TimerTickMsg`) carrying the remaining time in the active turn, consumed by clients to render a countdown. |

---

## 3. Requirements

### 3.1 Turn Timer (End-to-End)

#### REQ-025 — Server-side turn timer and auto-expiry
**User story:** As a participant, I want fixed-duration turns to actually end
on their own when time runs out, so that the relay doesn't stall waiting for
a manual action that may never come.

Acceptance criteria:
1. WHEN a turn starts under `fixed` or `fixed-early-end` mode, THE SYSTEM
   SHALL schedule an automatic turn-end at `turnConfig.durationMs` after the
   turn's `startedAt` timestamp.
2. WHEN a turn's scheduled duration elapses without an early-end or
   host-action ending it first, THE SYSTEM SHALL end the turn with reason
   `"expiry"` and SHALL advance to the next turn per the active selection
   policy (REQ-008).
3. IF a turn ends for any other reason (`"early-end"` or `"host-action"`)
   before its scheduled expiry, THEN THE SYSTEM SHALL cancel the pending
   auto-expiry for that turn (no duplicate turn-end, consistent with
   REQ-024's early-end/expiry race guard).
4. WHEN the session ends or the room is torn down, THE SYSTEM SHALL cancel
   any pending turn-expiry timers to prevent orphaned callbacks.

#### REQ-026 — Turn countdown broadcast
**User story:** As a participant, I want to see how much time is left in the
current turn, so that I know when control will pass.

Acceptance criteria:
1. WHILE a turn is active, THE SYSTEM SHALL periodically broadcast the
   remaining time via a turn-tick message to all connected participants.
2. THE SYSTEM SHALL broadcast turn-ticks at an interval no coarser than 1
   second, to support a smooth countdown display.
3. WHEN a turn ends (for any reason), THE SYSTEM SHALL stop broadcasting
   turn-ticks for that turn.

#### REQ-027 — Client turn countdown display
**User story:** As a participant, I want a visible countdown in the UI, so
that I don't have to guess how much time the current Driver has left.

Acceptance criteria:
1. WHILE a turn is active, THE CLIENT SHALL display the remaining turn time
   to all participants (Host, Observer, Spectator, Driver alike).
2. THE CLIENT SHALL update the displayed countdown at least once per second
   while a turn is active.
3. WHEN no turn is active (session `"created"` or between turns), THE CLIENT
   SHALL NOT display a stale or misleading countdown.

### 3.2 Driver & Turn Visibility

#### REQ-028 — Current driver display
**User story:** As a participant, I want to see who is currently driving, so
that I know whose edits I'm watching and whether it's my turn.

Acceptance criteria:
1. WHILE a turn is active, THE CLIENT SHALL display the current Driver's
   name to all participants.
2. WHEN the local user is the current Driver, THE CLIENT SHALL visually
   distinguish this (e.g., "You are driving") from when a remote user is
   driving.
3. WHEN no turn is active, THE CLIENT SHALL indicate that no Driver is
   currently active rather than showing stale driver information.

#### REQ-029 — Turn progress display
**User story:** As a participant, I want to see the current turn number, so
that I have a sense of session progress across multiple turns.

Acceptance criteria:
1. WHILE a turn is active or has occurred, THE CLIENT SHALL display the
   current/most recent turn number.

### 3.3 Driver Selection UI

#### REQ-030 — Manual driver assignment UI
**User story:** As a Host using manual driver selection, I want to pick the
next Driver from the roster, so that I can control turn order directly.

Acceptance criteria:
1. WHEN the session's `selectionPolicy` is `"manual"` AND the Host is
   eligible to start a new turn, THE CLIENT SHALL present the Host with a
   list of currently connected, eligible (non-spectator) participants to
   choose as the next Driver.
2. WHEN the Host selects a participant from this list, THE CLIENT SHALL
   send a turn-start action naming that participant as Driver.
3. THE CLIENT SHALL NOT present participants who are disconnected or who
   hold the Spectator role as eligible choices.
4. IF the Host is not the acting participant OR the selection policy is
   `"round-robin"`, THEN THE CLIENT SHALL NOT present this picker.

#### REQ-031 — Rotation order visibility
**User story:** As a participant under round-robin selection, I want to see
the upcoming driver order, so that I know when my turn is coming.

Acceptance criteria:
1. WHEN the session's `selectionPolicy` is `"round-robin"`, THE SYSTEM
   SHALL make the rotation order (or at minimum, the next eligible Driver)
   available to clients.
2. THE CLIENT SHALL display the rotation order (or next-up Driver) to all
   participants while the session is active.
3. WHEN a participant joins after the session starts and is inserted into
   the rotation per REQ-011, THE CLIENT SHALL reflect their inserted
   position in the displayed order on the next update.

### 3.4 Disconnect & Grace Period Visibility

#### REQ-032 — Disconnect grace period broadcast
**User story:** As a participant, I want to know when a grace period is
active (e.g., because the Driver or Host disconnected), so that the pause in
activity is explained rather than looking like a stall or bug.

Acceptance criteria:
1. WHEN the SYSTEM enters a disconnect grace period (per REQ-020/022), THE
   SYSTEM SHALL broadcast the grace period's start, the disconnected
   participant's identity, and the grace period duration to all connected
   participants.
2. WHEN the grace period ends (by reconnect, host action, or timeout), THE
   SYSTEM SHALL broadcast the resolution (reconnected / reassigned /
   extended / skipped) to all connected participants.
3. THE SYSTEM SHALL NOT expose grace-period internals (e.g., raw timers) to
   clients beyond what's needed to render a countdown and resolution state.

#### REQ-033 — Grace period client UX
**User story:** As a participant, I want a clear indication and, if I'm the
Host, actionable controls during a grace period, so that I understand what's
happening and can resolve it.

Acceptance criteria:
1. WHILE a disconnect grace period is active, THE CLIENT SHALL display
   which participant disconnected and a countdown to the grace period's
   expiry, to all connected participants.
2. WHILE a disconnect grace period is active AND the local user is the
   Host, THE CLIENT SHALL present actions to reassign, extend, or skip,
   consistent with the Host prompt described in REQ-020.
3. WHEN the grace period resolves, THE CLIENT SHALL clear the grace-period
   indicator and reflect the new state (new Driver, extended turn, or
   session continuing without the disconnected participant).

#### REQ-034 — Host disconnect distinct indicator
**User story:** As a participant, I want to specifically notice when the
Host (not just any participant) disconnects, since the Host controls session
administration, so that I'm not left wondering whether the session is still
being managed.

Acceptance criteria:
1. WHEN the roster shows the Host participant as disconnected, THE CLIENT
   SHALL render a visually distinct indicator for this case, separate from
   the generic per-participant connected/disconnected status already shown
   for all roles.
2. THE CLIENT SHALL make this indicator visible without requiring the user
   to open/expand the roster panel first.
3. WHEN the Host reconnects, THE CLIENT SHALL clear the distinct indicator.

### 3.5 Reconnection & Role Confirmation

#### REQ-035 — Role assignment broadcast on join/reconnect
**User story:** As a participant, I want my role and host-participation
status confirmed by the server on join and reconnect, so that my client's
local understanding of my permissions is always authoritative-server-derived,
never assumed.

Acceptance criteria:
1. WHEN a client successfully joins a room, THE SYSTEM SHALL send that
   client a role-assignment message confirming their `ParticipantId`, role,
   and (if applicable) host-participation mode.
2. WHEN a client reconnects (REQ-023), THE SYSTEM SHALL re-send a
   role-assignment message reflecting their current role, which may have
   changed since their prior connection.
3. THE CLIENT SHALL use the server-confirmed role/host-participation as the
   authoritative source for role-gated UI (e.g., host controls), not any
   client-cached value from before reconnect.

### 3.6 Control Feedback & Session Teardown

#### REQ-036 — Control rejection feedback
**User story:** As a user attempting a control action, I want to see why it
was rejected, so that I'm not left wondering if my click did nothing or
failed silently.

Acceptance criteria:
1. WHEN the CLIENT receives a control-rejected message in response to an
   action the local user initiated, THE CLIENT SHALL display a
   human-readable explanation of the rejection reason to that user.
2. THE CLIENT SHALL surface this feedback in a way that does not require
   the user to open developer tools or a console to see it.
3. THE CLIENT SHALL clear or dismiss the rejection feedback after a bounded
   time or on the user's next relevant action.

#### REQ-037 — Session-ended teardown UX
**User story:** As a participant, I want a clear indication when the session
has ended, so that I understand why the editor stopped updating instead of
assuming the app is broken.

Acceptance criteria:
1. WHEN the CLIENT receives a session-ended message, THE CLIENT SHALL
   transition the user out of the live editing view into a clear
   "session ended" state.
2. THE CLIENT SHALL NOT continue to present controls (host actions, driver
   actions, editing) that are no longer valid once the session has ended.
3. THE CLIENT SHALL offer the user a way to leave/return to the lobby from
   the "session ended" state.

#### REQ-038 — Early-end ineligibility affordance
**User story:** As a participant who is not currently eligible to end a
turn early, I want to understand why the option isn't available to me, so
that the missing button doesn't look like a bug.

Acceptance criteria:
1. WHEN the local user is not the current Driver, THE CLIENT SHALL NOT
   present an enabled early-end action, consistent with existing behavior.
2. WHEN the local user is the current Driver AND the active turn's mode
   does not permit early-end, THE CLIENT SHALL indicate that early-end is
   unavailable in this mode rather than omitting all explanation.

---

## 4. Non-Functional Requirements

- **NFR-010 (Timer overhead):** The server-side turn timer/scheduler SHALL
  NOT introduce unbounded timer accumulation; every scheduled turn-expiry
  and grace-period timer SHALL be cancelable and SHALL be cancelled when
  superseded (REQ-025.3, REQ-025.4).
- **NFR-011 (Broadcast cost):** Turn-tick broadcasts (REQ-026) SHALL be
  scoped to rooms with an active turn only; rooms with no active turn SHALL
  NOT receive tick traffic.
- **NFR-012 (Backward-compatible protocol growth):** New wire messages
  introduced by this feature (grace-period broadcasts, etc.) SHALL be
  additive to `packages/shared/src/protocol.ts`'s existing `ServerMessage`
  union; no existing message shape SHALL be modified in a breaking way.

---

## 5. Traceability

| Requirement | Origin Gap(s) | Related FEAT-001 Requirements |
|---|---|---|
| REQ-025, REQ-026 | G1, G2 | REQ-007, REQ-009, REQ-010, REQ-024 |
| REQ-027 | G1 | REQ-010 |
| REQ-028, REQ-029 | G3, G4 | REQ-009 |
| REQ-030 | G5 | REQ-008 |
| REQ-031 | G6 | REQ-008, REQ-011 |
| REQ-032, REQ-033 | G7 | REQ-020, REQ-022 |
| REQ-034 | G8 | REQ-022 (origin: `BUGFIX-004`) |
| REQ-035 | G9 | REQ-002.3, REQ-023.2 |
| REQ-036 | G10 | REQ-005.2 |
| REQ-037 | G11 | REQ-004 |
| REQ-038 | G12 | REQ-010.3/4 |

---

## 6. Relationship to Prior Work

This feature supersedes and formally incorporates the deferred/partial items
originally tracked as bugfixes:

- **`docs/bugfixes/BUGFIX-004-host-disconnect-indicator.md`** — its "Partially
  Fixed" scope (generic roster) is retained as already-shipped baseline; its
  deferred items (auto-notification, host-specific distinction, grace-period
  UI) are reclassified here as REQ-032/033/034 and tracked as feature work,
  not bugfix follow-up. `BUGFIX-004`'s status/document should be updated to
  reference this feature rather than continuing to accrue scope itself.
- **`docs/bugfixes/BUGFIX-005-nginx-crlf-entrypoint-crash.md`** — unrelated
  (infrastructure), unaffected by this feature.
- **`docs/bugfixes/BUGFIX-006` (session auto-cleanup, not yet written)** —
  remains a separate, deferred server-hygiene concern; explicitly out of
  scope for this feature (see §1.4).
- **`docs/bugfixes/HOST_UX_FLOW.md`** — a pre-existing UX walkthrough/mockup
  document for the host experience. **Verified against the actual client
  code** (`RoomEditor.tsx`, `SessionControls.tsx`) during FEAT-003 scoping:
  most of its "Part 8: UI Component States" mockups (specifically "State 2:
  Active Phase" showing a "Current Driver" / "Time Remaining" readout, and
  "State 3: Ended Phase" showing a "Session Ended" / "Return to Lobby"
  screen) **are not implemented** — there is no timer/countdown display, no
  rendered current-driver name, and no session-ended teardown view anywhere
  in the client, despite the document presenting these as existing UI
  states. The document's own §10 "Known Limitations" section is honest
  about most of these gaps (manual driver assignment UI, turn timer,
  disconnect grace period dialog are explicitly listed as "❌ Not
  Implemented"), but §8's mockups are not clearly marked as aspirational,
  which could mislead a reviewer into thinking they already exist.
  Every gap identified in `HOST_UX_FLOW.md` is already covered by this
  feature's requirements (timer → REQ-026/027, current driver → REQ-028,
  manual driver picker → REQ-030, grace-period dialog → REQ-032/033,
  session-ended screen → REQ-037), so **no new requirement was added on
  its account.** It is retained as a useful target-state UX reference for
  implementation (see Task cross-references in `tasks.md` §7) and should be
  corrected to clearly label §8's "State 2"/"State 3" mockups as
  target/future states rather than current behavior.
