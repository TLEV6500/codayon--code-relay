# Quick Summary: Four Issues Identified

## 1️⃣ Missing Host Admin Controls ❌

**What's Missing:** UI buttons for host to configure, start, and end sessions

- ✅ Protocol defined: `ConfigureMsg`, `StartSessionMsg`, `EndSessionMsg`, `StartTurnMsg`
- ✅ Server engine ready: `configured`, `sessionStarted`, `sessionEnded` event handlers exist
- ❌ **Server WS handler incomplete:** Control channel routing commented out (ws.ts:113)
- ❌ **No UI buttons** in client

**Fix Priority:** Medium | **Effort:** Medium | **Code Location:** ws.ts, App.tsx, need SessionControls component

---

## 2️⃣ Driver Can't End Turn Early ❌

**What's Missing:** UI button for driver to request early turn end (when enabled in config)

- ✅ Protocol: `EarlyEndMsg` defined
- ✅ Server: `earlyEndRequested` event handler exists
- ❌ **Control channel not wired** (same blocker as Issue #1)
- ❌ **No UI button**

**Fix Priority:** Medium | **Effort:** Low (after Issue #1 fixed) | **Code Location:** ws.ts, SessionControls component

---

## 3️⃣ User's Own Cursor Invisible 🙈

**What's Missing:** User sees remote cursors but NOT their own cursor in the editor

**Root Cause:** Intentional design decision, now problematic
```typescript
// ws.ts:247 - Socket publish EXCLUDES sender
ws.publish(roomTopic(ws.data.code), JSON.stringify(relayed));
// Comment: "Socket-level publish excludes the sender (REQ-018.1 'all OTHER users')"
```

**Impact:** 
- Remote users see each other's cursors with colors and names ✓
- Local user sees NOTHING representing their own cursor ✗
- Confusing UX: "Where is MY cursor?"

**Fix:** Send own presence to self immediately after broadcasting to room

**Fix Priority:** High | **Effort:** Low | **Code Location:** ws.ts:247 in `handlePresenceMessage()`

---

## 4️⃣ Sessions Not Auto-Cleaned When Empty 🚨

**What's Missing:** Automatic cleanup when all participants disconnect

- ✅ Protocol: REQ-004.1/2 specifies cleanup requirements
- ✅ Server: `endRoom()` exists in RoomRegistry
- ❌ **No trigger:** Only cleans up on explicit `endSession` from host
- ❌ **Memory leak:** Orphaned sessions accumulate indefinitely in `RoomRegistry.rooms` Map

**Evidence:** 
```typescript
// rooms.ts:211 - "Called when session.phase transitions to 'ended'"
// Implies manual host action, not automatic
```

**Fix:** Add auto-transition to "ended" phase when all participants disconnected

**Fix Priority:** Low | **Effort:** Low | **Code Location:** rooms.ts, ws.ts

---

## 5️⃣ No Visual Indicator When Host Leaves 👻

**What's Missing:** UI shows when host (or any participant) disconnects

- ✅ Protocol: `PresenceGoneMsg`, `SessionSnapshotMsg` with `connected` flag
- ✅ Server: Broadcasts all disconnect signals correctly
- ❌ **Client UI:** Receives signals but never displays them
- ❌ **No roster component:** No way to see who's connected

**Impact:**
- Users don't know if host is still present (host controls turn progression)
- Users don't know if other participants are still there
- No indication when driver disconnects (triggers grace period)

**Fix:** Create Roster component showing participants + connection status

**Fix Priority:** Medium | **Effort:** Medium | **Code Location:** Need Roster.tsx component

---

## Summary Table

| Issue | Severity | Is Showstopper? | Effort | Priority | Files |
|-------|----------|-----------------|--------|----------|-------|
| Host controls missing | Medium | No | Medium | 2 | ws.ts, App.tsx |
| Driver early-end missing | Medium | No | Low | 2 | SessionControls |
| **Own cursor invisible** | **High** | **No** | **Low** | **1** | **ws.ts** |
| Session not auto-cleaned | Low | No | Low | 4 | rooms.ts, ws.ts |
| Host disconnect not shown | Medium | No | Medium | 3 | Roster.tsx (new) |

---

## Next Steps

**Complete investigation:** See `INVESTIGATION_REPORT.md` for architectural analysis, code locations, and detailed recommendations.

**Quick wins (do these first):**
1. Fix own cursor visibility (ws.ts, 2 lines of code)
2. Wire control channel (ws.ts, ~30 lines)

**Then add UI:**
3. SessionControls component (host buttons, driver early-end)
4. Roster component (participant status)
