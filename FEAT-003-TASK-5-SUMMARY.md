# FEAT-003 Task 5: Rotation Order Visibility (Round-Robin)

**Status:** ✅ COMPLETE

**Commit:** b432bc6  
**Branch:** feat/003--session-ux-completion  
**Test Results:** 186 pass (160 existing + 26 new)

---

## Overview

Implemented REQ-031: Broadcast and display rotation order for round-robin mode, enabling participants to see the complete driver rotation order and which participant is "up next" in automatic (round-robin) selection mode.

## Requirements Met

### REQ-031: Rotation Order Visibility (Round-Robin)

✅ **Protocol addition (additive per NFR-012):**
- `RotationSnapshotMsg` added to `ServerMessage` union
- Fields: `order: ParticipantId[]`, `nextIndex: number`
- Sent over `control` channel

✅ **Server broadcast:**
- Broadcast alongside `SessionSnapshotMsg` when `selectionPolicy='round-robin'`
- Sent on:
  - Session start (when first turn begins)
  - Turn start/end (rotation advances)
  - Late-joiner insertion (new eligible participant joins)
  - Any rotation state change during round-robin mode
- Conditional broadcast: only when round-robin mode is active

✅ **Client tracking & display:**
- `RoomEditor` tracks `rotationOrder` and `rotationNextIndex` signals
- Receives `RotationSnapshotMsg` and updates signals
- Passes to `SessionControls` for display
- Displays in "Rotation Order" section only when:
  - `selectionPolicy='round-robin'`
  - `sessionPhase='active'`
  - Rotation order exists and has participants
- Next-up participant highlighted with blue background and "→ next" indicator
- Participant names resolved from roster; falls back to ID substring if not found

---

## Implementation Details

### 1. Protocol Changes

**File:** `packages/shared/src/protocol.ts`

Added `RotationSnapshotMsg`:
```typescript
export interface RotationSnapshotMsg {
  readonly channel: "control";
  readonly type: "rotationSnapshot";
  readonly order: readonly ParticipantId[];
  readonly nextIndex: number;
}
```

Added to `ServerMessage` union type (additive).

### 2. Server Changes

**File:** `packages/server/src/ws.ts`

Updated `broadcastSessionState()` function:
- Now publishes both `SessionSnapshotMsg` and `RotationSnapshotMsg` (when applicable)
- Checks if `turnConfig?.selectionPolicy === 'round-robin'` and `rotation` exists
- Broadcasts `order` and `nextIndex` from `room.session.rotation`

**Broadcast triggers:**
- After `configure` event (turn config set)
- After `startSession` event (session activated)
- After `startTurn` event (manual or first turn)
- After `earlyEnd` event (turn ended early, next turn advanced)
- After turn expiry callback (turn auto-expired, next turn advanced)
- On any participant connection state change in round-robin mode

### 3. Client Changes

**File:** `packages/client/src/components/RoomEditor.tsx`

Added signals:
```typescript
const [rotationOrder, setRotationOrder] = createSignal<readonly string[]>([]);
const [rotationNextIndex, setRotationNextIndex] = createSignal<number>(0);
```

Message handler:
- Added case for `msg.type === "rotationSnapshot"`
- Updates both `rotationOrder` and `rotationNextIndex` on receipt

Prop passing:
- Passes `rotationOrder()` and `rotationNextIndex()` to `SessionControls`

**File:** `packages/client/src/components/SessionControls.tsx`

Added props:
```typescript
readonly rotationOrder?: readonly string[];
readonly rotationNextIndex?: number;
```

Added helper functions:
- `getParticipantName(id)`: Resolves participant ID to name from roster
- `shouldShowRotationOrder()`: Determines visibility (round-robin + active + order exists)

Added UI component (in "Rotation Order" section):
- Conditional display using `<Show when={shouldShowRotationOrder()}>`
- Maps over `rotationOrder` with numbered list
- Highlights participant at `rotationNextIndex` with blue background
- Shows "→ next" indicator for next-up participant
- Uses participant names with fallback to ID substring

---

## Test Coverage

**File:** `packages/client/src/components/rotation-order.test.ts` (449 lines, 26 tests)

### Test Categories

**Display Visibility (5 tests):**
- Shows rotation order in correct conditions (round-robin + active + order exists)
- Hides in manual mode
- Hides when not active
- Hides when rotation list empty
- Hides when turnConfig null

**Next-Up Highlighting (4 tests):**
- Highlights index 0 correctly
- Highlights index 1 correctly
- Highlights last index correctly
- Wraps to index 0 after final participant

**Late-Joiner Insertion (2 tests):**
- Reflects insertion at correct position (fair insertion after those who haven't driven)
- Correctly reorders when hasDrivenInCycle status changes

**Participant Name Resolution (3 tests):**
- Resolves ID to name from roster
- Falls back to ID substring when participant not found
- Handles special characters in names

**Rotation Order Updates (4 tests):**
- Updates on participant disconnect (removal from rotation)
- Updates on participant reconnect
- Maintains nextIndex when participant list changes
- Wraps nextIndex when index becomes out of bounds

**Broadcast Scenarios (4 tests):**
- Broadcasts on session start (round-robin mode)
- Does not broadcast in manual mode
- Broadcasts on late-joiner insertion
- Broadcasts on turn advancement

**Edge Cases (4 tests):**
- Handles single participant rotation
- Handles all participants with same name
- Handles very long rotation (100 participants)
- Handles out-of-bounds nextIndex defensively

### Test Results

```
 26 pass (rotation-order tests)
 160 pass (existing tests)
---------
 186 pass total
 0 fail
 420 expect() calls
```

---

## Deliverables

### Code Files Modified

1. **packages/shared/src/protocol.ts**
   - Added `RotationSnapshotMsg` interface
   - Added to `ServerMessage` union

2. **packages/server/src/ws.ts**
   - Updated `broadcastSessionState()` to send `RotationSnapshotMsg` for round-robin mode

3. **packages/client/src/components/RoomEditor.tsx**
   - Added `rotationOrder` and `rotationNextIndex` signals
   - Added message handler for `rotationSnapshot`
   - Passes rotation state to `SessionControls`

4. **packages/client/src/components/SessionControls.tsx**
   - Added rotation props to `SessionControlsProps`
   - Added `getParticipantName()` and `shouldShowRotationOrder()` helpers
   - Added "Rotation Order" UI section with numbered list and highlighting

### Test File

5. **packages/client/src/components/rotation-order.test.ts**
   - 26 comprehensive tests covering all requirements and edge cases

### Build Results

✅ Client TypeScript strict: 0 errors  
✅ Client production build: 577 KB minified (no new errors/warnings)  
✅ All tests: 186 pass, 0 fail

---

## Design Decisions

### 1. Broadcast Approach
**Decision:** Broadcast `RotationSnapshotMsg` conditionally alongside `SessionSnapshotMsg`

**Rationale:**
- Additive protocol change (NFR-012): doesn't break existing clients
- Sent only in round-robin mode (no overhead for manual mode)
- Sent at every state change affecting rotation (ensures sync)
- Efficient: single broadcast instead of per-participant messages

### 2. Client-Side Tracking
**Decision:** Track rotation as signals in `RoomEditor`, pass to `SessionControls`

**Rationale:**
- Centralized state management in editor component
- Easy to pass reactive signals to child components
- Matches existing pattern for session state (turnNumber, currentDriver, etc.)
- UI can reactively update when rotation changes

### 3. Display Visibility
**Decision:** Show only in round-robin + active state

**Rationale:**
- Reduces UI clutter in manual mode (no automatic rotation to show)
- Only meaningful when there's an active session
- Empty rotation list (pre-session) shouldn't display
- Conditional rendering via `shouldShowRotationOrder()` helper

### 4. Participant Name Resolution
**Decision:** Resolve from roster with fallback to ID substring

**Rationale:**
- Names are human-readable
- Fallback handles edge case where participant joined but not in roster yet
- ID substring (first 8 chars) is unique enough for display
- Avoids creating pseudo-names or displaying raw UUIDs

### 5. Next-Up Highlighting
**Decision:** Blue background + "→ next" label on participant at `nextIndex`

**Rationale:**
- Visual distinction from other participants
- Color scheme consistent with existing blue accents in UI
- Arrow emoji provides intuitive "next" indication
- Not intrusive; color difference is subtle but clear

---

## Edge Cases Handled

1. **Single participant rotation** — wraps to self
2. **All participants same name** — distinguishable by ID in list
3. **Very long rotation (100+)** — renders efficiently
4. **Out-of-bounds nextIndex** — defensive modulo in display
5. **Participant disconnect** — removed from rotation, nextIndex adjusted
6. **Participant reconnect** — already in rotation (fair insertion on join)
7. **Late-joiner insertion** — placed after those who haven't driven in cycle
8. **Empty rotation pre-session** — doesn't display
9. **Manual mode** — no rotation broadcast or display
10. **Session ended** — rotation display hidden

---

## Requirements Compliance

| Requirement | Status | Evidence |
|-------------|--------|----------|
| REQ-031a: Add RotationSnapshotMsg | ✅ | protocol.ts:169-179 |
| REQ-031b: Broadcast on rotation changes | ✅ | ws.ts:546-573 |
| REQ-031c: Only broadcast in round-robin | ✅ | ws.ts:563-564 (conditional) |
| REQ-031d: Track in RoomEditor | ✅ | RoomEditor.tsx:51-52, 89-91 |
| REQ-031e: Display in SessionControls | ✅ | SessionControls.tsx:272-310 |
| REQ-031f: Show with next-up highlighted | ✅ | SessionControls.tsx:280-309 |
| REQ-031g: Tests for insertion & highlighting | ✅ | rotation-order.test.ts:26 tests |

---

## Verification Checklist

- ✅ Protocol changes are additive (no breaking changes)
- ✅ Server broadcasts RotationSnapshotMsg only for round-robin
- ✅ Client receives and tracks rotation state
- ✅ Display only shows in correct conditions
- ✅ Next-up driver correctly highlighted
- ✅ Participant names resolved from roster
- ✅ Late-joiner insertion reflected in display
- ✅ 26 new tests all passing
- ✅ All 160 existing tests still passing
- ✅ TypeScript strict mode: 0 errors (client)
- ✅ Production build succeeds
- ✅ Git commit created with descriptive message

---

## Future Enhancements

1. **Animations:** Slide/fade when rotation order changes
2. **Connected status:** Show connection indicator per participant in rotation
3. **Statistics:** Show how many turns each participant has had
4. **Custom ordering:** Allow host to reorder rotation (future feature)
5. **Export:** Export rotation history/stats at session end

---

## Related Tasks

- **FEAT-003 Task 1:** Turn timer end-to-end ✅
- **FEAT-003 Task 2:** Driver & turn visibility ✅
- **FEAT-003 Task 3:** Manual driver assignment UI ✅
- **FEAT-003 Task 4:** Rotation order visibility (this task) ✅
- **FEAT-003 Task 6:** Disconnect grace period UX (next)

---

**Implementation Complete** — Ready for review and integration testing.
