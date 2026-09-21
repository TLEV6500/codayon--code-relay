# Codayon Investigation Report: Missing UI Actions, Cursor Visibility & Session Management

**Date:** September 21, 2026  
**Status:** Investigation Complete  
**Scope:** Four interconnected issues affecting user experience and session lifecycle

---

## Executive Summary

The Codayon platform has significant gaps in user-facing functionality and session management:

1. **Missing Host Admin UI Controls** — Host lacks UI buttons to configure turns, start session, and end session
2. **Missing Driver Actions** — Driver cannot end their turn early (when enabled)
3. **Own Cursor Invisible** — User's own cursor is not displayed in the editor, only remote cursors are visible
4. **Missing Session Auto-Cleanup** — Sessions persist indefinitely even when all participants disconnect
5. **No Host Disconnect Indicator** — Other users receive no visual feedback when the host leaves

---

## Issue #1: Missing Host Admin UI Actions

### Current State

**Protocol Support:** ✅ Complete
- `ConfigureMsg` (configure turn mode/duration/selection policy)
- `StartSessionMsg` (start the session/first turn)
- `EndSessionMsg` (end the session)
- `StartTurnMsg` (start turn with chosen driver, for manual mode)
- `EarlyEndMsg` (driver ends turn early)

All message types are defined in `/packages/shared/src/protocol.ts` and properly typed.

**Server Support:** ✅ Mostly Present
- Server-side `engine.ts` has pure event handlers for:
  - `configured` events (REQ-007)
  - `sessionStarted` events (REQ-009.1)
  - `sessionEnded` events (REQ-004.1)
  - Turn advancement logic in `engine.ts`
- WebSocket handler at `/packages/server/src/ws.ts` (lines 95-114):
  - Handles "doc" channel messages only
  - Handles "presence" channel messages only
  - **MISSING:** Control channel handler (`else if (msg.channel === "control")`)
  - Comment at line 113 confirms: "control channel arrives in later tasks"

**Client Support:** ❌ Missing Entirely
- No UI buttons in `RoomEditor.tsx` or `App.tsx` to send these control messages
- `App.tsx` only shows "Leave" button in header
- No host-specific control panel or UI sections
- No role-based conditional rendering for host

### Impact

- Host cannot configure turn duration, mode, or selection policy
- Host cannot start the session
- Host cannot end the session
- Host cannot manually assign drivers (when using manual selection policy)
- Driver cannot end their turn early even if enabled in config

### Root Causes

1. **WS Handler Incomplete:** Control message routing not implemented in WebSocket layer
2. **No UI Component:** Missing dedicated component for host admin actions
3. **No Session State Display:** No way to show current session phase, turn config, or roster to users

---

## Issue #2: Missing Driver UI Actions (Early End Turn)

### Current State

**Protocol Support:** ✅ Complete
- `EarlyEndMsg` defined in protocol with `channel: "control"` and `type: "earlyEnd"`

**Server Support:** ✅ Present in Engine
- `earlyEndRequested` event handler exists in `engine.ts`
- Turn ending logic exists (handles expiry, early-end, host-action reasons)

**Client Support:** ❌ Missing Entirely
- No UI button for driver to request early turn end
- No mechanism to detect if current turn allows early end

### Impact

- Driver has no way to voluntarily end their turn (even if config permits)
- Users may feel stuck waiting for timer to expire

### Root Causes

1. **Control Channel Not Wired:** Same root cause as Issue #1
2. **No Role/Token Awareness on Client:** Client doesn't know if it's the current driver
3. **No Turn State Display:** Client doesn't see turn config (whether early-end is enabled)

---

## Issue #3: Own Cursor Not Visible in Editor

### Current State

**How Presence Works:**
- `presenceExtension()` in `/packages/client/src/collab/presence.ts` sends local cursor position via:
  ```typescript
  connection.send({
    channel: "presence",
    type: "presence",
    anchor: sel.anchor,
    head: sel.head,
  });
  ```
- Remote presence received as `RemotePresenceMsg` and rendered as decorations (lines 191-244)
- Remote cursor renders a `CursorWidget` with colored border and name label (lines 128-155)

**The Problem:**
- Server-side WebSocket handler publishes presence with `ws.publish()` which **excludes the sender** (line 247 in ws.ts):
  ```typescript
  ws.publish(roomTopic(ws.data.code), JSON.stringify(relayed));
  // Socket-level publish excludes the sender (REQ-018.1 "all OTHER users")
  ```
- Line 247 comment explicitly states: "Socket-level publish excludes the sender (REQ-018.1 'all OTHER users')"
- Client never receives its own presence back, so its own cursor is never rendered

**Why Unfair:**
- All **remote** users see their cursors rendered with colors and labels
- The **local** user sees absolutely nothing representing their own cursor
- CodeMirror's default cursor is minimal and hard to track in a busy editor
- User confusion: "Where is my cursor? Everyone else can see theirs but I can't see mine."

### Root Cause

**Intentional but Problematic Design Decision:**
- REQ-018.1 was interpreted as "presence should only be broadcast to OTHER users"
- This was implemented as a blanket exclusion at the socket level
- However, a user **should** see their own cursor/selection, just like in any normal editor
- Remote presence should be broadcast to everyone **including** the sender's own representation

### Code Location

- `/packages/server/src/ws.ts`, line 247 in `handlePresenceMessage()`
- `/packages/client/src/collab/presence.ts`, lines 191-244 (remote presence decoration)

---

## Issue #4: Session Auto-Cleanup When No Users Present

### Current State

**Session Lifecycle:**
- Sessions are created in "created" phase with a room code and host token
- Host configures and starts → "active" phase
- Host ends session → "ended" phase
- When phase becomes "ended", `RoomRegistry.endRoom(code)` should clean up (REQ-004.1/2)

**The Problem:**
No automatic cleanup when all participants disconnect.

**Evidence:**
- `/packages/server/src/rooms.ts`, line 211 comment:
  ```typescript
  /**
   * Clean up a room after session ends (REQ-004.1/2, REQ-003.3).
   * Purges doc, turn history, presence, participants, room code, and
   * invalidates all tokens. Called when session.phase transitions to "ended".
   */
  ```
- Note: "Called when session.phase transitions to 'ended'" — **implies manual host action**
- No event handler checks if participants map is empty
- No auto-transition of session phase when `connected` count reaches 0
- `ConnectionChanged` event updates participant `.connected` flag but doesn't trigger cleanup (engine.ts)

**Current Cleanup Flow:**
1. Host sends `endSession` message explicitly
2. Server applies `sessionEnded` event
3. Server calls `registry.endRoom(code)` only after phase becomes "ended"
4. **Missing:** Auto-end session when no participants are connected

**Implications:**
- Orphaned sessions accumulate in memory indefinitely
- Session state remains in `RoomRegistry.rooms` Map
- Tokens remain valid
- Late-joining participants can still join a room full of disconnected players
- Memory leak in long-running server

### Root Cause

**By Design (incomplete):**
- Requirements specify REQ-004 "session end" but do not explicitly require auto-end on zero participants
- No grace period logic for zero-participant scenarios
- Turnover/role management doesn't account for all-disconnected state

---

## Issue #5: Visual Indicator When Host Leaves Session

### Current State

**Protocol Support:** ✅ Present
- `RoleAssignedMsg` exists to inform clients of role changes (REQ-023.2)
- `SessionSnapshotMsg` includes roster with `connected` boolean per participant
- `PresenceGoneMsg` sent when any participant disconnects

**Client Support:** ⚠️ Partial
- Client receives and processes `SessionSnapshotMsg` via bootstrap
- No UI component displays the roster or shows when participants disconnect
- No special visual indication that the host specifically has disconnected

**Server Support:** ✅ Complete
- Presence system broadcasts `presenceGone` for all disconnects (REQ-018.4)
- Session state tracks `connected` flag per participant (engine.ts)
- Server applies `connectionChanged` events when socket opens/closes (ws.ts, lines 91-96, 122-128)

**The Problem:**
- Server sends all the signals (presence gone, session snapshot with connected flag)
- Client receives but **never displays** this information
- Users don't know if the host is still connected
- Users have no way to know if other participants are still connected
- Special case: No indication that the current **Driver** has disconnected (which triggers grace period)

### Impact

- Ambiguity about session viability
- Users may not realize host is gone (affecting turn progression and manual selection)
- No visual feedback on who is actively present
- Confusing UX when it's unclear if session is still alive

### Root Cause

1. **No Roster UI Component:** Missing component to display participants and their status
2. **No Client State for Presence:** Client doesn't maintain roster of who's connected
3. **No Driver Indicator:** No UI showing who currently holds the turn token

---

## Architectural Gaps

### Gap A: Control Channel Not Wired End-to-End

| Layer | Status | Evidence |
|-------|--------|----------|
| **Protocol** | ✅ Complete | `protocol.ts` defines all control messages |
| **Server WS Handler** | ❌ Missing | `ws.ts` line 113: "control channel arrives in later tasks" |
| **Client UI** | ❌ Missing | No button components or role-specific UI |
| **Client Transport** | ❌ Missing | No code to send control messages |

### Gap B: Client Has No Session State Representation

Current client state (`App.tsx`, line 9):
```typescript
interface Session {
  code: string;
  clientToken: string;
  clientID: string;
  role: "host" | JoinableRole;  // Static role only
}
```

Missing:
- Current session phase ("created" / "active" / "ended")
- Turn configuration (duration, mode, selection policy)
- Current turn info (driver, started-at, remaining time)
- Roster with connected status
- Whether this client is the current driver

### Gap C: No Roster/Status Display Component

No UI component exists to show:
- List of participants and their roles
- Connection status (connected/disconnected)
- Current driver
- Session phase and turn timer

### Gap D: Own Presence Blocked at Server Level

Design decision to exclude sender from `ws.publish()` prevents:
- User seeing their own cursor
- Symmetric experience (others see your cursor but you don't)

---

## Recommendations

### Immediate Fixes (High Priority)

#### 1. Fix Own Cursor Visibility
**Effort:** Low | **Impact:** High (improves UX significantly)

- **Change:** Send own presence to self at connection time and when it updates
- **Implementation:**
  - In `handlePresenceMessage()` ws.ts, after creating `relayed` message:
    - Send the message to the socket itself: `send(ws, relayed)`
    - Then publish to room: `ws.publish(...)`
  - Alternatively: Client sends own presence data to its editor's presence state on connection
  - Recommended: Server approach for consistency (presence is broadcast from server)

#### 2. Wire Control Channel End-to-End
**Effort:** Medium | **Impact:** High (enables turn management)

1. **Server WS Handler (ws.ts, line 113):**
   ```typescript
   else if (msg.channel === "control") {
     handleControlMessage(ws, room.code, registry, msg);
   }
   ```

2. **Create `handleControlMessage()` function** with cases for:
   - `configure`: Verify host, apply `configured` event
   - `startSession`: Verify host, apply `sessionStarted` event
   - `endSession`: Verify host, apply `sessionEnded` event
   - `startTurn`: Verify host + manual mode, apply turn start
   - `earlyEnd`: Verify actor is driver, apply `earlyEndRequested`

3. **Client UI (new `SessionControls.tsx` component):**
   - Host panel with buttons (configure, start, end)
   - Driver panel with "End Turn Early" button (when enabled)
   - Both send control messages via connection

#### 3. Create Roster/Status Component
**Effort:** Medium | **Impact:** Medium (improves visibility)

- New `Roster.tsx` component showing:
  - Participant list with roles
  - Connected status (✓/✗)
  - Current driver highlight
  - Turn timer (if turn active)
- Display in session header or sidebar

#### 4. Auto-Cleanup Sessions
**Effort:** Low | **Impact:** Low (server hygiene)

- Add check in `applyConnection()` when marking last participant disconnected
- Transition session to "ended" phase when:
  - Phase is "active"
  - All participants have `connected: false`
  - Optional grace period (e.g., 30 seconds) before cleanup
- Call `registry.endRoom(code)` on auto-end

### Medium-Term Enhancements

#### 5. Broadcast Driver Token Changes
**Current State:** Token holder not broadcast to clients  
**Impact:** Clients can't show who's driving

- Add state tracking for token holder changes
- Broadcast `driverChangedMsg` when `editTokenHolder` changes
- Client tracks current driver and highlights in UI

#### 6. Broadcast Turn Timer
**Current State:** Timer runs only on server  
**Impact:** Clients show no turn countdown

- Send `timerTickMsg` periodically (every 1s or key milestones)
- Client displays remaining seconds
- Animate color change as time expires

#### 7. Improve Disconnect Grace Period UX
**Current State:** Host sees grace period in engine but no UI  
**Impact:** Ambiguous turn state during disconnect

- Add `disconnectStateMsg` to broadcast grace period activation
- Show dialog: "Driver disconnected. Will auto-skip in X seconds. [Reassign] [Extend] [Skip]"

---

## Testing Recommendations

### Unit Tests (Missing)

- `ws.test.ts`: Add `handleControlMessage()` cases
- `presence.test.ts`: Add case for sender receiving own presence
- `rooms.test.ts`: Add auto-cleanup on zero connected

### Integration Tests (Missing)

- Full flow: create → join → configure → start → (driver action) → advance → end
- Disconnect scenarios: driver disconnect, observer disconnect, host disconnect
- Presence: verify sender sees own cursor

---

## Affected Files for Implementation

### Server-Side

- `/packages/server/src/ws.ts` — Wire control channel handler, fix presence
- `/packages/server/src/rooms.ts` — Add auto-cleanup logic (optional)
- `/packages/server/src/routes/rooms.ts` — May need bootstrap enhancement

### Client-Side

- `/packages/client/src/App.tsx` — Add session state tracking
- `/packages/client/src/components/RoomEditor.tsx` — Structural: session controls moved to header
- `/packages/client/src/components/SessionControls.tsx` — **NEW** Host/driver control buttons
- `/packages/client/src/components/Roster.tsx` — **NEW** Participant list + status
- `/packages/client/src/collab/transport.ts` — May need state updates for driver/turn info
- `/packages/client/src/collab/presence.ts` — Handle own presence reception

### Shared

- `/packages/shared/src/protocol.ts` — May add new message types (driver changed, timer tick, etc.)

---

## Conclusion

The codebase has solid architectural foundations (protocol, engine, relay) but lacks:

1. **Control plane implementation** — Control messages defined but not wired server-side or surfaced in UI
2. **Session state on client** — Client is stateless; can't reflect server state to user
3. **User feedback mechanisms** — No roster, timer, or turn indicators
4. **Own presence symmetry** — User can't see their own cursor like others can
5. **Session lifecycle automation** — No cleanup when all participants leave

All issues are **solvable** with targeted implementation. The protocol and domain logic are sound; the gaps are in the integration layers (WS handler) and UI presentation.

Recommended priority:
1. **Fix own cursor visibility** (quick win, high UX impact)
2. **Wire control channel** (unlocks turn management)
3. **Add roster/status UI** (improves transparency)
4. **Auto-cleanup** (server hygiene)
