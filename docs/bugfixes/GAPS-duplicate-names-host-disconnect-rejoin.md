# GAPS: Duplicate Names, Host-Disconnect Broadcast, and Host-Rejoin

**Status:** 📝 Documented via gap-documentation tests (no fixes applied — by design)  
**Branch:** `fix/ux-actions-and-presence` (follow-up to FEAT-003/FEAT-004)  
**Severity:** Medium (UX correctness + missing feature surface)  
**Impact:** Confusing roster identity, stale disconnect UI, hosts locked out of their own session

> **Purpose of this document:** Unlike `BUGFIX-001` through `BUGFIX-005`, the
> three gaps below are **not fixed** here. Per explicit product decision, this
> pass only adds tests that *document* current behavior — some gap-proving
> (expected to fail/timeout), some gap-confirming (expected to pass, because
> they assert the current permissive/absent behavior is exactly what it is).
> No production code in `engine.ts`, `rooms.ts`, `ws.ts`, `routes/rooms.ts`,
> or `App.tsx` was modified as part of this work. See "Testing" section per
> gap for exact file references and expected pass/fail status.

---

## Gap 1: No Duplicate-Name Detection on Join/Rejoin

### Problem Statement

Any number of participants — including a rejoining participant with a fresh
session identity — can share the exact same display name in a room's roster,
with no warning, error, or automatic disambiguation. This applies to:
- Two independent joins with an identical name (e.g., two people typing "Bob").
- Case-variant collisions (e.g., "Bob" and "bob" both allowed as distinct roster entries).
- A name colliding with the host's own name.
- A "rejoin" (disconnect, then join fresh) using the same name as before, now producing two roster rows for what a user would expect to be a single identity.

### Root Cause

**`packages/server/src/rooms.ts`**, `RoomRegistry.join()`:

```ts
join(
  code: string,
  name: string,
  role: JoinableRole,
): JoinRoomResult | RoomError {
  const room = this.rooms.get(code);
  if (!room) return "not-found";
  if (room.session.phase === "ended") return "ended";

  const participantId = this.gen.participantId();
  const clientToken = this.gen.token();

  room.session = applyEvent(room.session, {
    type: "participantJoined",
    id: participantId,
    name,          // <-- no uniqueness check against existing roster
    role,
  });
  room.clientTokens.set(clientToken, participantId);

  return { participantId, role, clientToken };
}
```

**`packages/shared/src/engine.ts`**, `applyEvent()` case `"participantJoined"`
(around line 236):

```ts
case "participantJoined": {
  // A joining attendee may only be observer or spectator (REQ-006.1).
  if (event.role !== "observer" && event.role !== "spectator") return state;
  if (state.participants.has(event.id)) return state;
  const next = new Map(state.participants);
  next.set(event.id, {
    id: event.id,
    role: event.role,
    name: event.name,   // <-- accepted verbatim, no collision check against
                         //     other entries in `state.participants`
    connected: true,
  });
  ...
```

Both layers key participants exclusively by `ParticipantId` (an opaque
generated string), never by `name`. `name` is purely a display label with
zero uniqueness constraint anywhere in the stack.

### Current (Permissive) Behavior

- Two `POST /api/rooms/:code/join` calls with `{ name: "Bob", role: "observer" }` both succeed (`201`-equivalent `200`), producing two roster entries with distinct `participantId`s and identical `name: "Bob"`.
- The pure engine (`applyEvent`) exhibits the same behavior directly, independent of the HTTP/registry layer.
- No case-normalization exists, so `"Bob"` and `"bob"` are treated as unrelated distinct strings — both permitted simultaneously.
- A host's own `name` (set at `POST /api/rooms`, e.g. `"Host"`) can be reused verbatim by any subsequent joiner.

### Testing

These are **gap-documentation tests** — they assert the above permissive
behavior is real today, and are expected to **pass** (there is nothing broken
to make them fail; the "bug" is the absence of a check, not an exception or
crash).

- `packages/shared/src/engine.duplicate-names.test.ts` — pure `applyEvent`/`createSession` tests (no server).
- `packages/server/src/rooms.duplicate-names.test.ts` — `RoomRegistry` instance-level tests, following `rooms.test.ts` conventions (`seededRegistry()`).

### What Fixing This Would Look Like (Not Implemented)

Not designed or implemented per product decision. For future reference, the
two most common approaches are: (a) reject join with an error if the
case-insensitive name already exists in the room's active roster, or (b)
auto-suffix (`"Bob (2)"`) to guarantee uniqueness silently. Either would need
a decision on whether disconnected-but-still-tracked participants (before
`endRoom()` purges them) count toward the collision check.

---

## Gap 2: Host/Participant Disconnect Doesn't Broadcast Immediately

### Problem Statement

When a non-driver participant (most critically, the **host**) disconnects
mid-session, other connected clients' rosters — and therefore the
host-disconnect indicator, which is derived from the roster's `connected`
flag — do not update in real time. The visual state goes stale until some
unrelated action happens to trigger a broadcast that piggy-backs the change.

### Root Cause

**`packages/server/src/ws.ts`**, the native WebSocket `close()` handler:

```ts
close(ws: ServerWebSocket<SocketData>) {
  // Purge this user's presence for everyone else (REQ-018.4) ...
  const gone: ServerMessage = { channel: "presence", type: "presenceGone", ... };
  ws.publish(roomTopic(ws.data.code), JSON.stringify(gone));
  ws.unsubscribe(roomTopic(ws.data.code));

  const room = registry.get(ws.data.code);
  if (room) {
    const oldState = room.session;
    room.session = applyConnection(room.session, ws.data.participantId, false);
    // ^ session state IS updated (participant.connected = false) ...

    // Handle grace period start on driver disconnect (REQ-032)
    if (
      oldState.currentTurn &&
      oldState.currentTurn.driverId === ws.data.participantId &&
      oldState.turnConfig?.durationMs
    ) {
      // ... broadcasts disconnectGraceStarted via ws.publish() here ...
    }
    // <-- NO ELSE BRANCH: if the disconnecting participant is NOT the
    //     current driver (e.g., they are the host but not currently
    //     driving, or any non-driving observer/spectator), there is no
    //     broadcastSessionState() call at all. The updated `connected: false`
    //     sits in server memory but is never sent to any other client.
  }
},
```

Compare to `open()` in the same file, and to every control-message handler
(`configure`, `startSession`, `endSession`, `startTurn`, `earlyEnd`,
`resolveGrace`), all of which call `broadcastSessionState(room, server, code)`
after mutating `room.session`. The `close()` handler is the **only** state
mutation site in `ws.ts` that conditionally skips this broadcast — it only
fires a `sessionSnapshot`-equivalent update when the disconnecting party
happens to be the active driver (via the grace-period path).

The client-side `host-disconnect-indicator` (`SessionControls.tsx`) is driven
entirely by `props.roster`, which is only ever updated by `RoomEditor.tsx`'s
subscription to `sessionSnapshot` messages. If that message never arrives,
the indicator never appears — regardless of how correct the server's internal
`room.session` state is.

### Current (Buggy) Behavior

- Host (not currently driving, or driver disconnect grace-period conditions not met) closes their WebSocket connection.
- Server correctly flips `participants.get(hostId).connected` to `false` internally.
- **No message is broadcast** to the observer's socket informing them of this change.
- The observer's `host-disconnect-indicator` never appears, and the roster (if opened) shows stale `connected: true` for the host, until/unless some other control action happens to trigger `broadcastSessionState()` for an unrelated reason.

### Testing

Unlike Gap 1, this is a **real bug** with a proveable failure mode — a
message that should arrive, does not. These tests are expected to
**fail or time out**, and that failure IS the documentation.

- `packages/server/src/ws.host-disconnect-broadcast.test.ts` — real WS-level regression test using the same `Bun.serve` + `RoomRegistry` harness pattern as `ws.test.ts`. Host + observer connect; host socket closes; the test races a `sessionSnapshot` reflecting `connected: false` for the host against a bounded timeout sentinel. **Expected: timeout branch wins, test fails.**
- `packages/e2e/src/host-disconnect-live-update.test.ts` — same gap, proven end-to-end via `Bun.WebView` + the e2e harness: host view closes, observer's `[data-testid="host-disconnect-indicator"]` is polled for and never appears within the timeout. **Expected: fails/times out.**

### What Fixing This Would Look Like (Not Implemented)

The fix is small in principle — call `broadcastSessionState(room, server, code)`
unconditionally in `close()`, not only inside the driver-disconnect grace-period
branch — but per product decision this is left as a documented, failing test
rather than patched in this pass.

---

## Gap 3: No "Rejoin as Host" UI/Backend Path

### Problem Statement

If a host loses their session (closes the tab, clears storage, switches
devices, or the `clientToken` is otherwise lost), there is **no way to
re-enter the room as host**. The lobby only offers to join as `"observer"`
(labeled "Join as participant") or `"spectator"` (labeled "Spectate"). The
secret `hostToken` returned at room-creation time is never usable again after
the initial `clientToken` from `POST /api/rooms` is lost — it authorizes
*administration actions* (per `RoomRegistry.isHostToken()`), but there is no
endpoint that accepts it to mint a *new* `clientToken` for reconnecting as
host.

### Root Cause

**`packages/server/src/routes/rooms.ts`**, `POST /rooms/:code/join`:

```ts
function isJoinRole(v: unknown): v is JoinableRole {
  return v === "observer" || v === "spectator";
  // ^ "host" is not, and cannot be, a valid value here — by type
  //   (`JoinableRole` in domain.ts excludes "host" entirely).
}

api.post("/rooms/:code/join", async (c) => {
  ...
  if (!isJoinRole(body.role)) {
    return c.json(
      { error: "invalid-role", message: "role must be 'observer' or 'spectator'" },
      400,
    );
  }
  ...
  const result = registry.join(code, name, body.role);
  ...
});
```

There is no `POST /rooms/:code/rejoin-host` (or equivalent) endpoint anywhere
in `packages/server/src/routes/rooms.ts` that accepts the room's `hostToken`
to authenticate and issue a fresh `clientToken` bound to the existing
`hostId`. `RoomRegistry.isHostToken()` exists and is used for *authorizing
already-connected* host actions (via the WS control channel's `isHost` check
in `ws.ts`), but nothing in the HTTP layer uses it to *restore* a lost host
session.

**`packages/client/src/App.tsx`**, the `Lobby()` component:

```tsx
<div class="flex gap-2">
  <button ... onClick={() => onJoin("observer")}>
    Join as participant
  </button>
  <button ... onClick={() => onJoin("spectator")}>
    Spectate
  </button>
</div>
```

`onJoin(role: JoinableRole)` only ever calls `joinRoom(code, { role, name })`
— there is no third button, no host-token input field, and no code path that
constructs a request carrying a `hostToken`. `onCreate()` is the only
function in `App.tsx` that produces a host session, and it can only be used
at room-creation time, never for rejoining an existing room as host.

### Current (Absent-Feature) Behavior

- A host who created a room and then loses their `clientToken`/session state has no lobby action, button, or API endpoint available to resume host authority over that room.
- Their only options are "Join as participant" (becomes an `observer` — loses all host administration rights: cannot configure, start, end the session, or resolve grace periods) or "Spectate" (loses edit rights too).
- The original `hostToken` (which the client may have retained, e.g. in local state or a copied link) is provably unusable for this purpose anywhere in the current codebase.

### Testing

This is a **missing feature**, not a regression from working code — so the
gap-documentation test asserts the current (absent) surface area directly,
and is expected to **pass** (it documents an accurate absence, not a crash).

- `packages/client/src/App.test.ts` — new `describe("Host rejoin gap (undocumented feature)", ...)` block, appended to the existing pure-logic-mirroring test file. Asserts the lobby's available join-role actions are exactly `["observer", "spectator"]`, and that no mirrored logic path accepts/uses a `hostToken` for re-authentication.

### What Fixing This Would Look Like (Not Implemented)

Per product decision (see options discussed and deferred), a
`POST /api/rooms/:code/rejoin-host` endpoint accepting the original
`hostToken` and reminting a `clientToken` bound to `hostId`, plus a lobby UI
affordance (e.g., a "Rejoin as Host" input/button gated on having a token to
paste), is the most direct design — but is explicitly **not implemented**
here.

---

## Summary Table

| Gap | Type | Root Cause Location | Test File(s) | Expected Result |
|-----|------|---------------------|---------------|------------------|
| 1. Duplicate names | Missing validation | `rooms.ts::join()`, `engine.ts::participantJoined` | `engine.duplicate-names.test.ts`, `rooms.duplicate-names.test.ts` | ✅ Pass (documents permissive behavior) |
| 2. Host-disconnect broadcast | Real bug | `ws.ts::close()` (missing `broadcastSessionState()` call) | `ws.host-disconnect-broadcast.test.ts`, `host-disconnect-live-update.test.ts` (e2e) | ❌ Fail/timeout (proves the bug) |
| 3. Host-rejoin | Missing feature | `routes/rooms.ts` (no endpoint), `App.tsx` (no UI) | `App.test.ts` (new describe block) | ✅ Pass (documents accurate absence) |

---

## Sign-Off

| Role | Status | Date |
|------|--------|------|
| Gap analysis | ✅ Complete | 2026-09-22 |
| Gap-documentation tests | ✅ Complete | 2026-09-22 |
| Fixes | ⏳ Explicitly deferred (product decision) | — |
| Code Review | ⏳ Pending | — |

---

## Related Documentation

- [INDEX.md](INDEX.md) — Bugfix index and navigation
- [BUGFIX-004-host-disconnect-indicator.md](BUGFIX-004-host-disconnect-indicator.md) — prior work on the roster/disconnect UI this gap analysis builds on
- `docs/requirements/FEAT-003-session-ux-completion/` — REQ-032/033/034 grace-period and host-disconnect-indicator requirements
- `docs/requirements/FEAT-004-e2e-ui-testing/` — e2e harness and testing conventions used for Gap 2's e2e proof
