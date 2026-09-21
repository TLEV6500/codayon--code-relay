# BUGFIX-003: Missing Driver Early-End Action

**Status:** ✅ FIXED  
**Branch:** `fix/ux-actions-and-presence`  
**Commits:** `3a0da18` (integrated with SessionControls)  
**Severity:** Medium (Feature Gap)  
**Impact:** Driver cannot end turn early even if enabled

---

## Problem Statement

### User Impact

When a session is configured with `mode: "fixed-early-end"`, drivers should be able to end their turn before the timer expires. However:

- No UI button exists for drivers to request early end
- No way to communicate early-end request to server
- Drivers are forced to wait for full timer expiry

This reduces flexibility and feels constraining when a driver finishes their code changes early.

### Root Cause

**Two Interrelated Gaps:**

1. **Control Channel Not Wired** (PRIMARY)
   - File: `packages/server/src/ws.ts` line 113
   - `earlyEnd` messages sent by clients are silently dropped
   - Server engine supports `earlyEndRequested` event but it's never triggered

2. **No UI Component** (SECONDARY)
   - File: `packages/client/src/components/RoomEditor.tsx`
   - No way for driver to know if they can end early
   - No button visible for early-end action
   - Client doesn't track current driver or turn config

### Evidence

**Protocol Defined:**
```typescript
// packages/shared/src/protocol.ts
export interface EarlyEndMsg {
  readonly channel: "control";
  readonly type: "earlyEnd";
}
```

**Server Engine Ready:**
```typescript
// packages/shared/src/engine.ts
{
  readonly type: "earlyEndRequested";
  readonly by: ParticipantId;
}
```

**Handler Missing:**
```typescript
// packages/server/src/ws.ts (missing)
case "earlyEnd": { ... }  // ← NOT IMPLEMENTED
```

**Client UI Missing:**
```typescript
// No SessionControls component
// No tracking of current driver
// No turn config visibility
```

---

## Solution

The fix leverages the control channel handler and SessionControls component (BUGFIX-002). This spec focuses on the driver-specific logic.

### Server Handler

**New Case in `handleControlMessage()`** (BUGFIX-002 code)

```typescript
case "earlyEnd": {
  // Only the current driver can end early (REQ-010.3)
  if (actor !== room.session.editTokenHolder) {
    send(ws, {
      channel: "control",
      type: "controlRejected",
      reason: "invalid-state",
    });
    return;
  }
  // Early-end only allowed in early-end mode (REQ-010.4)
  if (room.session.turnConfig?.mode !== "fixed-early-end") {
    send(ws, {
      channel: "control",
      type: "controlRejected",
      reason: "invalid-state",
    });
    return;
  }
  room.session = applyEvent(room.session, {
    type: "earlyEndRequested",
    by: actor,
  });
  broadcastSessionState(room, server, code);
  return;
}
```

**Authorization Checks:**
1. Must be current edit token holder: `actor === editTokenHolder`
2. Must be in early-end mode: `turnConfig.mode === "fixed-early-end"`
3. Failure returns: `controlRejected` with `reason: "invalid-state"`

**State Transition:**
- Applies `earlyEndRequested` event to session
- Engine marks turn as ended
- Broadcasts updated state to all clients

### Client UI

**SessionControls Component** (BUGFIX-002 code)

```typescript
{/* Driver Early-End Button */}
<Show when={props.isCurrentDriver && props.turnConfig?.mode === "fixed-early-end"}>
  <div class="border border-slate-700 rounded-lg p-3 bg-slate-900/60">
    <button
      onClick={handleEarlyEnd}
      class="w-full px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded text-sm"
    >
      End Turn Early
    </button>
  </div>
</Show>
```

**Visibility Logic:**
- Button only shows if BOTH conditions true:
  1. `props.isCurrentDriver` — User is current driver
  2. `props.turnConfig?.mode === "fixed-early-end"` — Config allows early end

**Action Handler:**

```typescript
const handleEarlyEnd = () => {
  props.connection.send({
    channel: "control",
    type: "earlyEnd",
  });
};
```

**Client State Tracking** (BUGFIX-002 code)

```typescript
// Track current driver from turn events
const [currentDriver, setCurrentDriver] = createSignal<string | null>(null);
const [turnConfig, setTurnConfig] = createSignal<TurnConfig | null>(null);

// Subscribe to updates
connection.onMessage((msg: ServerMessage) => {
  if (msg.channel === "control") {
    if (msg.type === "sessionSnapshot") {
      const snapshot = msg as SessionSnapshotMsg;
      setTurnConfig(snapshot.turnConfig);
      setRoster(snapshot.roster);
    } else if (msg.type === "turnStarted") {
      const turn = msg as TurnStartedMsg;
      setCurrentDriver(turn.driver);  // ← Track driver
    } else if (msg.type === "turnEnded") {
      setCurrentDriver(null);
    }
  }
});

// Determine if local user is driver
const isCurrentDriver = currentDriver() === props.clientID;

// Pass to SessionControls
<SessionControls
  ...
  isCurrentDriver={isCurrentDriver}
  turnConfig={turnConfig()}
/>
```

---

## User Experience

### Before Fix

**Driver perspective during fixed-early-end turn:**
```
Turn: Alice (3:00 remaining)
↓
[Stares at editor while typing code]
↓
Finishes code at 2:15
↓
[Stuck waiting for 2:15 more while holding token]
↓
Turn expires naturally after 3:00
```

### After Fix

**Driver perspective with same setup:**
```
Turn: Alice (3:00 remaining)
↓
[Types code]
↓
Finishes at 2:15
↓
Clicks "End Turn Early" button (visible in control panel)
↓
Turn ends immediately, token passes to Bob
```

---

## Testing

### Automated Tests

**Existing Tests (all passing):**

```typescript
test("early-end (REQ-010.3/4, REQ-024) > driver can request early-end in early-end mode [0.04ms]", () => {
  // ... setup turn in early-end mode ...
  const result = applyEvent(session, {
    type: "earlyEndRequested",
    by: driverId,
  });
  expect(result.currentTurn?.ended).toBe(true);
});

test("early-end (REQ-010.3/4, REQ-024) > non-driver cannot request early-end [0.08ms]", () => {
  // ... setup turn ...
  const result = applyEvent(session, {
    type: "earlyEndRequested",
    by: observerId,  // Not the driver
  });
  expect(result.currentTurn?.ended).toBe(false);
});

test("early-end (REQ-010.3/4, REQ-024) > early-end is rejected in fixed mode (REQ-010.4) [0.03ms]", () => {
  // ... setup turn in fixed (not early-end) mode ...
  const result = applyEvent(session, {
    type: "earlyEndRequested",
    by: driverId,
  });
  // Engine ignores the event (no-op)
  expect(result).toEqual(session);
});
```

### Manual Testing

**Test Case 1: Driver Early-End (Allowed)**

Setup:
1. Create room
2. Configure: Select "Fixed Duration (Early End Allowed)"
3. Start session
4. Wait for first turn to begin

Verification:
1. **Expected:** "End Turn Early" button visible in control panel
2. **Expected:** Button is amber/yellow colored
3. Click button
4. **Expected:** Turn ends immediately
5. **Expected:** Button disappears
6. **Expected:** Next driver's turn begins

**Test Case 2: Fixed Mode (Not Allowed)**

Setup:
1. Create room
2. Configure: Select "Fixed Duration" (no early end)
3. Start session

Verification:
1. **Expected:** "End Turn Early" button NOT visible
2. Wait for turn to start
3. **Expected:** Button still not visible even during active turn
4. **Expected:** Turn only ends after full duration

**Test Case 3: Non-Driver**

Setup:
1. Create room
2. Configure and start
3. Observe from non-driving participant

Verification:
1. **Expected:** "End Turn Early" button NOT visible
2. When driver is different participant
3. **Expected:** Button stays hidden for observers

**Test Case 4: Server Rejection**

Setup:
1. Create room in "fixed" mode (no early-end)
2. Manually send `earlyEnd` message (via browser console)

Verification:
1. **Expected:** Server returns `controlRejected` with reason `"invalid-state"`
2. **Expected:** Turn does not end
3. **Expected:** Session continues normally

---

## Requirements Compliance

| Requirement | Status | Implementation |
|------------|--------|----------------|
| REQ-010.1 (Timer Starts) | ✅ | Engine tracks turn start/end |
| REQ-010.3 (Early End Request) | ✅ | `earlyEnd` message + `earlyEndRequested` event |
| REQ-010.4 (Mode Guard) | ✅ | Handler checks `mode === "fixed-early-end"` |
| REQ-024 (Exactly-Once) | ✅ | Turn marked as `ended` on first end |

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `packages/server/src/ws.ts` | Included in BUGFIX-002 | earlyEnd case in handleControlMessage |
| `packages/client/src/components/SessionControls.tsx` | Included in BUGFIX-002 | Early-end button + logic |
| `packages/client/src/components/RoomEditor.tsx` | Included in BUGFIX-002 | Track currentDriver + turnConfig |

---

## Deployment Notes

### Interaction with BUGFIX-002

This fix depends on:
- `handleControlMessage()` being present
- `SessionControls` component being integrated
- Client state tracking for driver/config

All deployed together in commit `3a0da18`.

### Backward Compatibility

**Graceful Degradation:**
- Clients without SessionControls won't see button but can still send `earlyEnd` manually
- Server always checks mode before accepting early-end
- Old clients never see "fixed-early-end" mode if not explicitly configured

### Feature Flag Consideration

Early-end could be made optional in future via feature flag:
```typescript
const allowEarlyEnd = config?.mode === "fixed-early-end" && featureFlags.driverEarlyEnd;
```

Currently, it's always enabled when mode is set.

---

## Commit Message

See BUGFIX-002 (integrated as part of SessionControls feature):

```
feat: add SessionControls component and integrate into client UI

Implements host and driver UI controls for session management and turn actions:

New Component:
- SessionControls.tsx: Provides
  - Host configuration dialog (turn duration, mode, selection policy)
  - Host session control buttons (start, end)
  - Driver early-end turn button (when enabled) ← THIS FEATURE
  - Session status display and roster with connection indicators
  ...
```

---

## Sign-Off

| Role | Status | Date |
|------|--------|------|
| Developer | ✅ Ready | 2026-09-21 |
| Tests | ✅ Passing (78/78) | 2026-09-21 |
| Review | ⏳ Pending | — |
| QA | ⏳ Pending | — |
