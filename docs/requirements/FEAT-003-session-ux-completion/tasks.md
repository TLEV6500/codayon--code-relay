# FEAT-003 — Session UI/UX Completion — Tasks

**Status legend:** `[x]` complete · `[~]` in progress · `[ ]` not started
**Source:** [`requirements.md`](./requirements.md) · [`design.md`](./design.md)

Each task is a working, demoable increment, built test-first where
applicable, ending by wiring into the running app. No orphaned code.

---

- [x] **Task 1 — Turn scheduler: server-side expiry + tick broadcast**
  - New `packages/server/src/turnScheduler.ts`: `scheduleTurnExpiry`,
    `startTurnTicks`, `cancelTurnTimers`, keyed per room code. Wire into
    `handleControlMessage`'s `startTurn`/`earlyEnd` cases and into
    `endRoom()` for cleanup.
  - On expiry fire: apply `turnEnded(reason: "expiry")`, advance to the
    next turn per selection policy, broadcast `TurnEndedMsg` +
    `TurnStartedMsg` + `SessionSnapshotMsg`.
  - On each tick: broadcast `TimerTickMsg { remainingMs }`.
  - **Requirements:** REQ-025, REQ-026; NFR-010, NFR-011.
  - **Verified:** `turnScheduler.test.ts` — expiry fires once at the
    correct delay; cancellation prevents firing; replacing an active timer
    doesn't leak the prior one; ticks stop after cancellation. `ws.test.ts`
    extended to observe `TimerTickMsg`/`TurnEndedMsg(reason: "expiry")` on
    a real connected client using a short test `durationMs`.

- [x] **Task 2 — Client turn countdown display**
  - `RoomEditor.tsx`: new `remainingMs` signal, updated on `TimerTickMsg`.
  - `SessionControls.tsx`: countdown rendered in the "Session Status"
    block; client-side interpolation between server ticks (reset on each
    tick, never drifts ahead of server truth); hidden/neutral when no turn
    is active.
  - **Requirements:** REQ-027.
  - **Demo:** start a turn with a short duration (e.g., 15s); watch the
    countdown tick down across two tabs in sync; turn auto-advances at 0
    without any host/driver action.

- [x] **Task 3 — Current driver + turn number display**
  - `RoomEditor.tsx`: render `currentDriver` (already tracked but unused)
    and turn number in `SessionControls.tsx`.
  - Distinct "You are driving" treatment when the local user is the
    current Driver vs. a remote driver's name shown otherwise.
  - Clear/neutral state when no turn is active.
  - **Requirements:** REQ-028, REQ-029.
  - **Demo:** two tabs, round-robin session; both tabs show the same
    driver name simultaneously; the driving tab shows "You are driving".

- [x] **Task 4 — Manual driver assignment UI**
  - `SessionControls.tsx`: driver picker listing connected, non-spectator
    roster entries, shown only for host + `selectionPolicy: "manual"` +
    turn-start-eligible state. Sends `startTurn { driver }` on selection.
  - **Requirements:** REQ-030.
  - **Demo:** configure a session with manual selection; host picks each
    driver by name from a list; picker excludes a disconnected/spectator
    tab.

- [x] **Task 5 — Rotation order visibility (round-robin)**
  - Protocol: new `RotationSnapshotMsg` (additive `ServerMessage` member).
  - Server: broadcast `RotationSnapshotMsg` alongside `SessionSnapshotMsg`
    whenever rotation state changes (turn start/end, late-joiner
    insertion) and `selectionPolicy === "round-robin"`.
  - Client: `RoomEditor.tsx` tracks `rotationOrder`; `SessionControls.tsx`
    renders the order with the next-up driver highlighted.
  - **Requirements:** REQ-031.
  - **Demo:** three-participant round-robin session; rotation list shown
    to all; a fourth participant joins mid-session and appears inserted
    fairly on the next update (per REQ-011).

- [x] **Task 6 — Disconnect grace period: server wiring**
  - Protocol: new `DisconnectGraceStartedMsg`, `DisconnectGraceResolvedMsg`
    (`ServerMessage`), `ResolveGraceMsg` (`ClientMessage`) — all additive.
  - `turnScheduler.ts`: grace-period timer started on `connectionChanged`
    marking the current driver or host disconnected; on fire, applies the
    engine's existing `gracePeriodElapsed` reducer case and broadcasts
    `DisconnectGraceResolvedMsg(resolution: "skipped" | ...)` per the
    engine's safe-default behavior (REQ-020/022); on reconnect or
    `resolveGrace`, cancels the timer, applies `hostActionTaken` (or the
    reconnect path), and broadcasts the resolution.
  - `handleControlMessage`: new `resolveGrace` case, host-only, validated
    against an active `disconnectState`.
  - **Requirements:** REQ-032; ties into existing REQ-020/022 engine logic
    (`connectionChanged`, `gracePeriodElapsed`, `hostActionTaken` — already
    implemented in `engine.ts`, confirmed during design audit).
  - **Verified:** extend `ws.test.ts`/`e2e.test.ts` — simulated driver
    disconnect starts a grace period broadcast; timeout without host action
    resolves per the safe default; explicit host `resolveGrace` (each of
    reassign/extend/skip) resolves correctly and cancels the timer.

- [x] **Task 7 — Disconnect grace period: client UX**
  - `RoomEditor.tsx`: `graceState` signal populated from
    `DisconnectGraceStartedMsg`/cleared on `DisconnectGraceResolvedMsg`.
  - New `GracePeriodModal.tsx`: host-only modal with Reassign (reuses the
    Task 4 driver-picker UI), Extend, Skip actions; sends `resolveGrace`.
  - `SessionControls.tsx`: non-blocking countdown banner shown to all
    participants (not just host) while `graceState !== null`.
  - **Requirements:** REQ-033.
  - **Demo:** close a driver's tab mid-turn; all other tabs show a grace
    countdown; the host's tab additionally shows reassign/extend/skip
    actions; resolving any of them clears the banner everywhere.

- [x] **Task 8 — Host-specific disconnect indicator**
  - `SessionControls.tsx`: distinct, always-visible (not roster-gated)
    banner/badge when `roster.find(p => p.role === "host")?.connected ===
    false`. Clears automatically on host reconnect.
  - **Requirements:** REQ-034 (supersedes `docs/bugfixes/BUGFIX-004`'s
    deferred scope — see that document's "Related Issues" section).
  - **Demo:** host closes their tab; observer/spectator tabs immediately
    show a host-disconnected indicator without needing to open the roster
    panel.

- [x] **Task 9 — Role assignment confirmation on join/reconnect**
  - Server: emit `RoleAssignedMsg` from the room-join HTTP bootstrap path
    and from the WS `open` handler on (re)connect.
  - Client: `RoomEditor.tsx`/`App.tsx` treat the server-confirmed role as
    authoritative for role-gated UI, overriding any client-cached role on
    reconnect.
  - **Requirements:** REQ-035.
  - **Demo:** reconnect a tab after a role change (e.g., host reassigns a
    spectator to observer mid-session); the reconnecting client's UI
    reflects the new role without a manual refresh assumption.

- [x] **Task 10 — Control rejection feedback**
  - `RoomEditor.tsx`: subscribe to `ControlRejectedMsg`, correlate to the
    local user's most recent control action, populate a `controlError`
    signal.
  - `SessionControls.tsx`: transient, auto-dismissing banner rendering the
    human-readable reason (map `"not-host"` / `"not-configured"` /
    `"invalid-state"` to plain-language text).
  - **Requirements:** REQ-036.
  - **Demo:** a non-host attempts a host-only action (e.g., via a stale UI
    state or direct message); the actor sees a clear rejection reason
    instead of silence.

- [x] **Task 11 — Session-ended teardown UX**
  - `App.tsx`/`RoomEditor.tsx`: subscribe to `SessionEndedMsg`; transition
    to a dedicated "session ended" view instead of leaving the live editor
    mounted; remove/disable all host/driver controls in this state.
  - "Return to lobby" action clears local session state.
  - **Requirements:** REQ-037.
  - **Demo:** host ends the session; every connected tab (host and
    participants) is moved out of the editor into a clear ended-state
    screen with a way back to the lobby.

- [x] **Task 12 — Early-end ineligibility affordance**
  - `SessionControls.tsx`: when the local user is the current Driver but
    `turnConfig.mode !== "fixed-early-end"`, show a disabled/explained
    state (e.g., "Early end not enabled for this session") rather than
    omitting the control entirely.
  - **Requirements:** REQ-038.
  - **Demo:** a `fixed`-mode session's driver sees why they can't end
    early, instead of no button at all.

- [x] **Task 13 — Documentation & bugfix cross-reference cleanup**
  - Update `docs/bugfixes/BUGFIX-004-host-disconnect-indicator.md` status
    to point to FEAT-003 (this feature) for its deferred scope, per
    `requirements.md` §6.
  - Update `docs/bugfixes/INDEX.md` cross-references accordingly.
  - Update root `README.md` feature list to mention FEAT-003 alongside
    FEAT-001/002, consistent with existing convention.
  - Correct `docs/bugfixes/HOST_UX_FLOW.md` §8 ("UI Component States") to
    clearly label the "Active Phase" current-driver/timer readout and the
    "Ended Phase" screen as target/future states (implemented by this
    feature's Tasks 2/3/11), not current behavior — verified during
    FEAT-003 scoping that neither exists in `SessionControls.tsx`/`App.tsx`
    today (see `requirements.md` §6).
  - **Requirements:** documentation hygiene, no functional requirement.
  - **Verified:** manual review — no dangling references to superseded
    "deferred" language describing now-implemented functionality.
