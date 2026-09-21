# Host UX Flow: Room & Session Configuration

**Document:** Comprehensive host user experience for room creation and session setup  
**Branch:** `fix/ux-actions-and-presence`  
**Status:** Complements BUGFIX-002 and BUGFIX-004  
**Target Audience:** Product, Design, QA, Developers

---

## Overview

This document details the complete user experience flow for hosts managing room creation, session configuration, and turn management in Codayon.

**What's Covered:**
- Room creation workflow
- Session configuration flow
- Turn progression
- Session management
- Real-time status feedback

**What's Not Covered:**
- Technical implementation details (see BUGFIX-002)
- Server-side authorization (see BUGFIX-002)
- Participant join flow (separate document)

---

## Part 1: Room Creation

### Step 1.1: Lobby - Create Room

**User Action:**
1. Opens Codayon at `http://localhost:8080`
2. Sees lobby screen
3. Enters name in "Your name" field (optional, defaults to "Host")
4. Clicks "Create a room" button

**UI State:**
```
┌─────────────────────────────────────────┐
│          Codayon — Lobby                │
├─────────────────────────────────────────┤
│                                         │
│  Your name: [_Alice_______]             │
│                                         │
│  [Create a room]                        │
│                                         │
│  ─────────────────────────────────────  │
│         or join                         │
│  ─────────────────────────────────────  │
│                                         │
│  [ROOM CODE]          [Join as part...] │
│                       [Spectate]        │
│                                         │
└─────────────────────────────────────────┘
```

**System Response:**
- API call: `POST /api/rooms { hostName: "Alice", hostParticipation: "host-participant" }`
- Server returns: `{ code, hostToken, clientToken }`
- Client transitions to session view

**Result:** Room created, host enters session

---

### Step 1.2: Session View - Initial State

**Screen Layout:**
```
┌──────────────────────────────────────────────────────────┐
│ Codayon | Room ABCD · host | [Leave]                     │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Language: [TypeScript ▼]    ┌─ Host Controls ───────┐  │
│                              │ Configure & Start      │  │
│                              │ Session               │  │
│                              └───────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                                                     │ │
│  │               [Empty Editor Canvas]                │ │
│  │                                                     │ │
│  │                                                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**Session Status Panel (Collapsed):**
```
Session Status                    [Show Roster]
Phase: created
Duration: —
Mode: —
```

**Key Elements:**
- Language selector (top-left)
- Host Controls panel (top-right) with "Configure & Start Session" button
- Empty editor (main area)
- Session Status (collapsed by default)

**State Tracking:**
- `sessionPhase: "created"`
- `turnConfig: null`
- `currentDriver: null`
- `roster: [{ id: "p_host", name: "Alice", role: "host", connected: true }]`

---

## Part 2: Session Configuration

### Step 2.1: Open Configuration Dialog

**User Action:**
1. Clicks "Configure & Start Session" button in Host Controls

**UI Change:**
- Dialog overlay appears (modal)
- Prevents interaction with editor until dismissed

**Configuration Dialog:**
```
┌────────────────────────────────────────┐
│         Configure Turns                │
├────────────────────────────────────────┤
│                                        │
│ Turn Duration (seconds)                │
│ [180_____________________] (3 min)    │
│  ↑ 10        50  100  150  200  250  ↑ │
│                                        │
│ Turn Mode                              │
│ ◉ Fixed Duration                       │
│ ○ Fixed Duration (Early End Allowed)  │
│                                        │
│ Driver Selection                       │
│ ◉ Round-Robin (Automatic)             │
│ ○ Manual (Host Assigns)               │
│                                        │
│              [Start Session]           │
│                                        │
└────────────────────────────────────────┘
```

**Default Values:**
- Duration: 180 seconds (3 minutes)
- Mode: "fixed"
- Policy: "round-robin"

**Interaction:**
- All fields editable
- Start Session button ready to click

---

### Step 2.2: Configure Turn Parameters

**Scenario A: Use Defaults**

**User Action:**
- Leaves all settings at defaults
- Clicks "Start Session"

**Result:**
- 3-minute turns
- Fixed duration (no early-end)
- Round-robin driver rotation

---

**Scenario B: Customize Settings**

**User Action:**
1. Adjusts duration slider to 120 seconds (2 minutes)
2. Selects "Fixed Duration (Early End Allowed)"
3. Selects "Manual (Host Assigns)"
4. Clicks "Start Session"

**Configuration Review:**
```
Turn Duration: 120 seconds
Turn Mode: fixed-early-end
Driver Selection: manual
```

**Result:**
- 2-minute turns with option for drivers to end early
- Host manually assigns each driver (not automatic rotation)
- Ready to start session

---

### Step 2.3: Start Session

**User Action:**
- Clicks "Start Session" button

**System Actions:**
1. Client sends `configure` message to server
2. Server validates and applies configuration
3. Client sends `startSession` message to server
4. Server transitions session to "active" phase
5. Server starts first turn with initial driver
6. Server broadcasts `sessionSnapshot` to all clients

**Timeline:**
```
T+0ms: User clicks "Start Session"
T+10ms: Client sends configure message
T+20ms: Server applies config
T+30ms: Client sends startSession message
T+40ms: Server starts active phase + first turn
T+50ms: Broadcast to all clients
T+100ms: Dialog closes, UI updates
```

**Client Response:**
- Dialog closes automatically
- Configuration dialog disappears
- Status panel updates
- Editor becomes interactive

**UI After Start:**
```
┌──────────────────────────────────────────────────────────┐
│ Codayon | Room ABCD · host | [Leave]                     │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Language: [TypeScript ▼]    ┌─ Host Controls ───────┐  │
│                              │ [End Session]         │  │
│                              └───────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                                                     │ │
│  │               [Editor Canvas - Editable]           │ │
│  │                                                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  Session Status                   [Show Roster]          │
│  Phase: active                                           │
│  Duration: 120s                                          │
│  Mode: fixed-early-end                                   │
│  Selection: manual                                       │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**Session Status Now Visible:**
- Phase changed to "active"
- Turn config displayed
- "End Session" button available

---

## Part 3: Turn Management

### Step 3.1: First Turn - Host is Driver

**Initial State (if host-participant mode):**
- Host automatically becomes first driver
- Host has edit token
- Host sees own cursor in editor
- Host can type/edit code

**Display:**
```
Turn: Alice (host) - 2:00 remaining
[Editor actively editable - cursor visible]
```

**Host Actions:**
- Edit code normally
- See other participants' cursors as they join
- See roster updates as participants join/disconnect

---

### Step 3.2: Participants Join

**Event: Observer Joins (e.g., Bob)**

**What Host Sees:**
1. New participant appears in roster (if shown)
2. Bob's cursor appears in editor as he moves it
3. Session state updates but doesn't interrupt host

**Roster Display (if expanded):**
```
Participants
● Alice (host)
● Bob (observer)
```

**What Bob Sees:**
1. Alice's cursor visible in editor
2. Alice's code changes as they type
3. Bob waiting for turn assignment

---

### Step 3.3: Turn Expires (Round-Robin Mode)

**Automatic Progression:**

**Host Configuration:** Round-robin mode (not manual)

**Timeline:**
1. Alice's 2-minute turn ends
2. Server triggers `turnEnded` event
3. Server auto-advances to next driver (Bob)
4. Server sends `turnStarted` message
5. All clients update display

**What Host Sees:**
```
[Turn ended for Alice]
↓
Turn: Bob (observer) - 2:00 remaining
[Editor becomes read-only for host]
[Bob's cursor now visible in editor]
```

**Host Actions:**
- Can still see editor and edits
- Cannot edit (read-only)
- Can start new turn only via configuration (if manual mode)
- Can end session

---

### Step 3.4: Host Ends Current Turn (Manual Mode)

**Manual Mode Setup:** Host in control of driver assignment

**Host Wants to Assign Driver:**

**Prerequisite:** Session in manual mode

**Host's Action:**
1. Session shows current driver assignment interface
2. Host clicks turn-end or sees "Next: [driver selector]"
3. Host selects next driver from roster
4. Server validates and assigns token

**UI (Manual Mode - Future Enhancement):**
```
Current Driver: Alice - 1:30 remaining

[Assign next driver: (Bob  ▼)]
               or [End Turn Now]
```

**Result:**
- Current turn ends
- Token passes to selected driver
- Selected driver becomes editable
- Others see read-only

---

### Step 3.5: Driver Ends Turn Early (If Enabled)

**Scenario:** Mode is "fixed-early-end", Bob is driver

**Bob's Action:**
- Finishes coding early (1:00 remaining)
- Clicks "End Turn Early" button (visible in Bob's control panel)

**What Host Sees:**
```
Turn: Bob (observer) - 1:00 remaining
↓ [Bob clicks End Turn Early]
↓
Turn ended by Bob
↓
Turn: Charlie (observer) - 2:00 remaining
```

**Host Experience:**
- Session automatically advances
- No host action needed
- Turn timer updates in real-time (if shown)

---

### Step 3.6: Host Ends Session

**User Action:**
1. Host clicks "End Session" button
2. Browser shows confirmation: "End the session? This cannot be undone."
3. Host clicks "Yes"

**System Response:**
1. Client sends `endSession` message
2. Server transitions phase to "ended"
3. Server cleans up room (invalidates tokens)
4. Server broadcasts `sessionSnapshot` with phase: "ended"
5. All clients receive end notification

**What Host Sees:**
```
Session has ended.

[Return to Lobby] button appears
```

**Result:**
- Session closed for all participants
- Cannot rejoin with same room code
- Room code becomes invalid

---

## Part 4: Real-Time Feedback

### Roster Updates

**Host Sees Live Changes:**

**When Participant Connects:**
```
Participants                [Show/Hide]
● Alice (host)
● Bob (observer)      ← Just joined
● Charlie (spectator)
```

**When Participant Disconnects:**
```
Participants
● Alice (host)
● Bob (observer)      ← Still visible but...
○ Charlie (spectator) ← Red dot = disconnected
```

**When Participant Reconnects:**
```
Participants
● Alice (host)
● Bob (observer)
● Charlie (spectator) ← Back online, green dot
```

---

### Session Status Display

**Always Visible (Can be Toggled):**

**State: Created (Before Start)**
```
Session Status
Phase: created
Duration: —
Mode: —
Selection: —
```

**State: Active (During Relay)**
```
Session Status
Phase: active
Duration: 120s
Mode: fixed-early-end
Selection: manual
```

**State: Ended (After Completion)**
```
Session Status
Phase: ended
Duration: 120s
Mode: fixed-early-end
Selection: manual
```

---

## Part 5: Host Actions Summary

### Available Actions by Phase

#### Phase: "created"

| Action | Button | Prerequisites | Result |
|--------|--------|---------------|--------|
| Configure Turns | "Configure & Start Session" | None | Open dialog |
| Skip to Active | (in future) | — | Jump to active phase |
| Leave Room | "Leave" (header) | None | Return to lobby |

#### Phase: "active"

| Action | Button | Prerequisites | Result |
|--------|--------|---------------|--------|
| Edit Code | Editor | Host is driver | Modify shared doc |
| End Turn | (future, manual mode) | Manual mode + host is admin | Assign next driver |
| End Session | "End Session" | None | Transition to ended |
| View Roster | "Show/Hide Roster" | None | Toggle roster display |
| Leave Room | "Leave" (header) | None | Disconnect (session continues) |

#### Phase: "ended"

| Action | Button | Prerequisites | Result |
|--------|--------|---------------|--------|
| Return to Lobby | (auto-shown) | None | Exit to lobby |
| Leave Room | "Leave" (header) | None | Return to lobby |

---

## Part 6: Error Handling

### Configuration Errors

**Scenario: Invalid Duration**

**User Input:** Duration = 5 seconds (below minimum)

**Client Validation:**
- Input field has min="10"
- Invalid values rejected before sending

**Result:** Cannot submit below minimum

---

**Scenario: Start Without Configure**

**User Action:** (Not possible via UI, but if API called directly)

**Server Response:**
```json
{
  "channel": "control",
  "type": "controlRejected",
  "reason": "not-configured"
}
```

**Client Behavior:** Shows error toast

---

### Authorization Errors

**Scenario: Non-Host Tries to Configure**

**Context:** Observer in Tab 2 tries to send configure message

**Server Response:**
```json
{
  "channel": "control",
  "type": "controlRejected",
  "reason": "not-host"
}
```

**Client Behavior:** Action silently fails (no UI button for non-host anyway)

---

### Session State Errors

**Scenario: Try to Start Session Twice**

**First Click:** Works, session goes to active
**Second Click:** Not possible (button changed to "End Session")

---

## Part 7: Complete Host Journey

### Timeline: First 5 Minutes

```
T+0:00  Host creates room, enters session view
        Phase: created
        Status: "Configure & Start Session" button visible

T+0:05  Host adjusts settings in configuration dialog
        Duration: 120s, Mode: fixed-early-end, Policy: manual

T+0:10  Host clicks "Start Session"
        Client sends: configure, startSession messages
        Server approves and starts session

T+0:15  Session active, host is first driver
        Phase: active, Editor editable, Cursor visible

T+0:30  Observer Bob joins
        Host sees Bob's cursor in editor
        Roster shows: Alice (host), Bob (observer)

T+1:45  Host typing code, 1:15 remaining on turn

T+2:00  Host finishes, turn expires (assuming round-robin if that mode)
        OR
        Host clicks "End Turn" to assign next driver (if manual)

T+2:05  Bob becomes driver
        Host becomes read-only observer
        Bob's cursor now editable in editor

T+4:00  Bob ends turn early (if early-end allowed)
        Charlie becomes driver

T+5:00  Host decides to end session
        Clicks "End Session"
        Confirms in dialog
        Session ended for all participants
```

---

## Part 8: UI Component States

### Host Controls Panel States

**State 1: Created Phase**
```
┌─ Host Controls ────────────────────┐
│                                    │
│  [Configure & Start Session]       │
│                                    │
└────────────────────────────────────┘
```

**State 2: Active Phase**
```
┌─ Host Controls ────────────────────┐
│                                    │
│  [End Session]                     │
│                                    │
│  Current Driver: Bob (observer)    │
│  Time Remaining: 1:30              │
│                                    │
└────────────────────────────────────┘
```

**State 3: Ended Phase**
```
┌─ Host Controls ────────────────────┐
│                                    │
│  Session Ended                     │
│  [Return to Lobby]                 │
│                                    │
└────────────────────────────────────┘
```

---

## Part 9: Multi-Tab Testing

### Scenario: Host in Tab 1, Observer in Tab 2

**Timeline:**

```
Tab 1 (Host)                    Tab 2 (Observer)
─────────────────────────────────────────────────────
Create room, config
                                Join room code
Phase: active                   Phase: active
Roster: Alice (host)            Roster: Alice (host)
                                          Bob (observer)
Host editing code
                                "Waiting for turn..."
                                Sees Alice's cursor
Host clicks "End Turn"
                                "Turn assigned to Bob"
Phase: read-only               Phase: active/editable
Bob's cursor editable           Can now edit
```

---

## Part 10: Known Limitations

### Current Implementation

✅ **Implemented:**
- Room creation
- Session configuration (3 options: duration, mode, policy)
- Start session
- End session
- Roster display (connection status)
- Turn transitions (round-robin automatic, manual TBD)
- Early-end button for driver (if enabled)

❌ **Not Implemented:**
- Manual driver assignment UI (checkbox/select in roster)
- Turn timer countdown display
- Driver disconnect grace period dialog
- Connection activity log
- Auto-cleanup on zero participants
- Turn history/transcript

⏳ **Deferred:**
- Advanced admin features (pause, reset, rewind)
- Analytics dashboard
- Session templates/presets
- Team/organization management

---

## Part 11: Browser DevTools Verification

### State in Redux DevTools (if added)

```
{
  session: {
    code: "ABCD",
    clientID: "c_xxx",
    role: "host"
  },
  sessionPhase: "active",
  turnConfig: {
    mode: "fixed-early-end",
    durationMs: 120000,
    selectionPolicy: "manual"
  },
  currentDriver: "p_bob",
  roster: [
    { id: "p_alice", name: "Alice", role: "host", connected: true },
    { id: "p_bob", name: "Bob", role: "observer", connected: true }
  ]
}
```

### Network Tab (WebSocket Messages)

```
→ client sends:
  { channel: "control", type: "configure", ... }
  { channel: "control", type: "startSession" }

← server broadcasts:
  { channel: "control", type: "sessionSnapshot", phase: "active", ... }
  { channel: "presence", type: "presence", participantId: "p_bob", ... }
```

---

## Part 12: Accessibility Considerations

### Keyboard Navigation

- Tab between fields in configuration dialog
- Enter to submit dialog
- Spacebar to toggle roster
- Alt+L to leave room (future enhancement)

### Screen Reader Support

- Button labels clear: "Configure & Start Session"
- Status updates announced: "Session active, your turn"
- Roster items labeled: "Alice, host, connected"
- Error messages: "Session configuration failed: not configured"

---

## Part 13: Mobile/Responsive Considerations

### Small Screen (< 768px)

**Configuration Dialog:**
- Full-width modal
- Touch-friendly sliders
- Vertical layout

**Session Controls:**
- Stack vertically
- Larger tap targets
- Icons + text for clarity

### Large Screen (>= 1400px)

**Two-Column Layout (Future):**
```
[Editor | Status Panel]
                [Host Controls sidebar]
                [Roster]
                [Chat]
```

---

## Summary

The host UX flow covers:

1. ✅ **Room Creation** — Straightforward, one click
2. ✅ **Configuration** — 3-option dialog, clear defaults
3. ✅ **Session Start** — Validates and starts immediately
4. ✅ **Turn Progression** — Automatic (round-robin) or controlled (manual - TBD)
5. ✅ **Real-Time Feedback** — Roster updates, status display
6. ✅ **Session End** — Clean shutdown with confirmation
7. ⚠️ **Manual Driver Assignment** — UI not yet implemented (server ready)
8. ⏳ **Advanced Features** — Deferred to future tasks

**What Hosts Can Do Now:**
- Create rooms instantly
- Configure 3 turn parameters
- Start sessions and begin coding
- See live roster with connection status
- Monitor session phase and config
- End sessions cleanly

---

## Cross-Reference to Bugfix Specs

| UX Flow Section | Related Bugfix | Related Requirement |
|-----------------|----------------|-------------------|
| Room Creation | — | REQ-001 (Create room) |
| Configuration | BUGFIX-002 | REQ-007 (Turn config) |
| Session Start | BUGFIX-002 | REQ-009.1 (Start session) |
| Session End | BUGFIX-002 | REQ-004.1 (End session) |
| Turn Management | BUGFIX-002, BUGFIX-003 | REQ-009, REQ-010 |
| Roster Display | BUGFIX-004 | REQ-002 (Roster) |
| Early-End Button | BUGFIX-003 | REQ-010.3 (Early end) |

---

## Document Version

- **Version:** 1.0
- **Date:** 2026-09-21
- **Status:** Complete
- **Branch:** fix/ux-actions-and-presence
