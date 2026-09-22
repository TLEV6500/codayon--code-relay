# BUGFIX-006: Client URL Parameter Parsing for Room Auto-Join

**Status:** 🔴 Open — spec ready, implementation pending  
**Branch:** `fix/FEAT-004-url-autojoin-and-bootstrap-errors`  
**Commits:** (pending implementation)  
**Severity:** High (blocks 18 of 23 FEAT-004 e2e tests; MVP feature gap)  
**Impact:** ⏳ Pending — FEAT-004 e2e test suite depends on this fix to validate FEAT-003 UI surfaces

---

## Problem Statement

### User Impact

The FEAT-004 end-to-end UI test suite (23 tests across 12 test files) navigates directly to URLs like:

```
http://127.0.0.1:46395/room/E8ZACG?clientToken=2de9c52b-3611-4c5d-94b1-97d4b54f74e7
```

**Expected behavior:** Client parses the URL, reads `room/{code}` and `?clientToken={token}`, and automatically joins the session — `RoomEditor` mounts, WebSocket relay connects, `SessionControls` renders.

**Actual behavior:** Client ignores URL parameters and shows the lobby screen, waiting for manual user input (Create/Join buttons). `SessionControls` never mounts.

**Result:** 19 of 23 e2e tests fail because their render-level assertions cannot find the components they're testing (e.g., `selectors.sessionControls`, `selectors.turnCountdown`, `selectors.driverVisibility`). The tests fail not because the features are broken, but because the test *entry point* is unimplemented — the browser lands on the correct URL but the app doesn't understand it.

### Why This Matters

- **For e2e tests:** Without URL-driven joins, the tests would need to programmatically click Create/Join UI elements inside the browser, adding fragility and complexity. Direct URL navigation is the clean test entry point.
- **For real users:** While not critical for MVP (users can manually paste codes into the lobby), URL-based entry enables:
  - Shareable direct links (`Copy link to room`)
  - Deep linking from notifications or external systems
  - One-click join flows
  - Better UX in future mobile/native clients
- **For this project:** URL-driven joins are a natural extension of the server's existing `GET /api/rooms/:code/bootstrap` endpoint, which already resolves `?clientToken={token}` → participant role server-side (REQ-035). The missing piece is purely client-side URL parsing and conditional session initialization.

### Root Cause

**Verified by code inspection:**

`packages/client/src/App.tsx` currently:
1. Initializes a `session` signal as `null`
2. Renders either `Lobby` (when session is null) or `RoomEditor` (when session is set)
3. Only sets the session via `onCreate()` or `onJoin()` callbacks — both triggered by lobby form interactions
4. Never inspects `window.location.pathname` or `window.location.search` to extract room code/token

**Evidence:**

Checked `App.tsx` at current HEAD (`fa15349`):
- No `window.location` parsing anywhere in the component
- No conditional auto-join logic on mount
- Lobby form still shows even when a valid room code/token are in the URL
- When navigating directly to `/room/ABC?clientToken=xyz`, browser console shows no errors, but UI remains on the lobby screen

**Why Wasn't This Caught Earlier:**

- FEAT-004's task breakdown included "write e2e tests" and "make tests pass," but the TDD workflow correctly identified the tests fail because the feature (URL parsing) is incomplete, not because tests are broken.
- The server-side bootstrap endpoint (REQ-002.4, already shipped in FEAT-001) fully supports tokens and role resolution; the client just needs to wire it together.
- No existing feature requires URL-driven joins, so no user noticed the gap pre-MVP.

---

## Recommended Solution

### Design Overview

Parse URL parameters in `App.tsx` on component init (one-time, not reactive), and conditionally auto-join if both room code and client token are present in the URL:

1. **Parse URL on mount:**
   - Extract room code from `window.location.pathname` (regex: `/room/([A-Z0-9]+)`)
   - Extract client token from `window.location.search` (URLSearchParams: `?clientToken=...`)

2. **Auto-initialize session if both present:**
   - Set `session()` to `{ code, clientToken, clientID: randomClientID(), role: "observer" }` (placeholder role)
   - The placeholder `"observer"` role is safe because `RoomEditor.tsx`'s `onMount` already calls `bootstrapRoom(code, clientToken)`, which returns the real role from the server (REQ-035), and immediately calls `setRole(boot.role)` — overwriting the placeholder within milliseconds.
   - No type changes needed; the `RoomEditor.role` prop already accepts `"host" | "observer" | "spectator"`.

3. **Handle bootstrap failures gracefully:**
   - Wrap `bootstrapRoom` call in `RoomEditor.onMount` with try/catch
   - Add new `onBootstrapError?: (message: string) => void` callback prop to `RoomEditorProps`
   - Call the callback on failure, passing a human-readable error message
   - In `App.tsx`, wire the callback to reset the session and display an error in the existing lobby error banner (reuse `error()` signal)
   - User sees "failed to join: [reason]" in the lobby and can try again or create a new room

4. **Strip token from visible URL after successful join:**
   - After bootstrap succeeds in `RoomEditor.onMount`, call `window.history.replaceState({}, "", "/room/{code}")`
   - Avoids leaving a potentially-sensitive `clientToken` in the browser address bar, browser history, or shareable links
   - The token is already captured in the `session` object in memory, so WS connection and relay communication continue to work

5. **No server changes required:**
   - `GET /api/rooms/:code/bootstrap?clientToken=...` already exists and resolves role correctly
   - `POST /api/rooms/:code/join` (if ever needed for future role-change flows) already supports tokens
   - WebSocket relay already accepts `?clientToken=` as a query param in the upgrade request

### Implementation Sketch

**In `App.tsx` (on component init, before JSX render):**

```typescript
// Parse URL for room code and token
const urlParams = new URLSearchParams(window.location.search);
const codeFromURL = window.location.pathname.match(/\/room\/([A-Z0-9]+)/)?.[1];
const tokenFromURL = urlParams.get("clientToken");

// Auto-join if both are present and session is not yet set
createEffect(() => {
  if (codeFromURL && tokenFromURL && !session()) {
    setSession({
      code: codeFromURL,
      clientToken: tokenFromURL,
      clientID: randomClientID(),
      role: "observer", // Placeholder; bootstrap will provide the real role
    });
  }
});
```

**In `RoomEditor.tsx` (error handling):**

```typescript
// RoomEditorProps now includes:
onBootstrapError?: (message: string) => void;

// In onMount:
onMount(async () => {
  try {
    const boot = await bootstrapRoom(props.code, props.clientToken);
    const conn = await connectRelay({ code: props.code, clientToken: props.clientToken });
    setConnection(conn);
    
    // Use server-confirmed role from bootstrap (REQ-035)
    if (boot.role) {
      setRole(boot.role);
    }
    
    // Strip token from URL after successful join
    window.history.replaceState({}, "", `/room/${props.code}`);
    
    // ... rest of setup
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to join room";
    props.onBootstrapError?.(message);
  }
});
```

**In `App.tsx` (error callback):**

```typescript
<RoomEditor
  code={s().code}
  clientToken={s().clientToken}
  clientID={s().clientID}
  role={s().role}
  onSessionEnded={() => setSessionEnded(true)}
  onBootstrapError={(message) => {
    setSession(null);
    setError(message);
  }}
/>
```

---

## Testing Strategy

### Unit / Integration Tests (in `packages/client`)

**Test 1: URL parsing on component mount**
- Mock `window.location` with pathname `/room/ABC123` and search `?clientToken=xyz`
- Assert that `session()` is set with `code: "ABC123"`, `clientToken: "xyz"`, and `role: "observer"`
- Assert that `session()` is **not** set if URL is missing code OR token OR both
- Verify test fails before implementation (red), passes after (green)

**Test 2: Bootstrap error handling**
- Mock `bootstrapRoom` to throw an error
- Assert that `RoomEditor` calls `onBootstrapError` with the error message
- Verify the callback fires in `App.tsx`, resetting `session` to null and setting an error message

**Test 3: URL token stripping**
- Mock `window.history.replaceState`
- Assert that after a successful bootstrap, `replaceState` is called with the token-stripped URL (`/room/CODE`)
- Assert that it is **not** called if bootstrap fails

### E2E Tests (via `bun run test:e2e`)

All 19 currently-failing e2e tests should pass once this feature is implemented:

- `connection.test.ts` REQ-042: SessionControls mounts after relay connects ✅
- `role-confirmation.test.ts` REQ-043: Role-gated UI reflects server role ✅
- `turn-timer.test.ts` REQ-044: Turn countdown renders and decrements ✅
- `driver-visibility.test.ts` REQ-045: Driver and turn number visibility ✅
- `manual-driver-picker.test.ts` REQ-046: Manual driver picker conditions ✅
- `rotation-order.test.ts` REQ-047: Rotation order visibility ✅
- `grace-period.test.ts` REQ-048: Grace period banner + host modal ✅
- `host-disconnect.test.ts` REQ-049: Host-disconnect indicator ✅
- `control-rejection.test.ts` REQ-050: Control rejection banner ✅
- `session-ended.test.ts` REQ-051: Session-ended teardown view ✅
- `early-end-affordance.test.ts` REQ-052: Early-end ineligibility affordance ✅

(Note: `turn-timer.test.ts` has a second test with an unrelated invalid click-selector bug; see BUGFIX-007 for details.)

### Manual Verification

1. Run dev client: `bun run --cwd packages/client dev`
2. Create a room via `http://localhost:5173` (lobby)
3. Capture the room code and host token from the response (or server logs)
4. Open a new browser tab and manually navigate to: `http://localhost:5173/room/{CODE}?clientToken={TOKEN}`
5. Verify:
   - SessionControls renders (no lobby screen)
   - Address bar changes from `/room/...?clientToken=...` to `/room/...` (token stripped)
   - WebSocket connects and editor receives updates
6. Test failure case: navigate to `/room/BADCODE?clientToken=invalid`
7. Verify:
   - Lobby screen appears
   - Red error banner shows "Failed to bootstrap room" or similar message

---

## Requirements Compliance

| Requirement (FEAT-004) | Before Fix | After Fix |
|-----------|-----------|-----------|
| E2E tests can navigate directly to room URLs | ❌ Lobby always shows, tests blocked | ✅ Auto-join works, tests can proceed |
| SessionControls mounts when URL provides token (REQ-042) | ❌ Never mounts for URL-based joins | ✅ Mounts on bootstrap success |
| Role is confirmed server-side, not guessed client-side (REQ-035) | ✅ Server logic exists, but client unused for URL joins | ✅ Client uses server role via bootstrap |
| Sensitive tokens not exposed in browser history/shareable URLs | ❌ Token remains in URL after join | ✅ Token stripped via `replaceState` |
| Bootstrap failures don't crash the app (REQ-002.4) | ❌ Unhandled error in browser console | ✅ Graceful fallback to lobby + error message |

---

## Files to Modify

| File | Changes | Lines Est. |
|------|---------|-----------|
| `packages/client/src/App.tsx` | Add URL parsing effect on mount; wire `onBootstrapError` callback to reset session + show error | +25–30 |
| `packages/client/src/components/RoomEditor.tsx` | Add `onBootstrapError` prop; wrap `bootstrapRoom` call in try/catch; add `history.replaceState` after success | +20–25 |
| `packages/client/src/App.test.ts` (or new) | Unit test for URL parsing behavior (3–4 tests) | +40–50 |
| Total | — | ~85–105 |

---

## Deferred to BUGFIX-007 (Contingent)

During research, a secondary issue was identified in `turn-timer.test.ts`:

The test calls `hostView.click('button:has-text("Configure & Start Session"), button:contains(...)')`, using non-standard CSS pseudo-selectors (`:has-text`, `:contains`) that the native `Bun.WebView.click()` (backed by Chrome DevTools Protocol) does not support. This may cause that specific test to fail even after BUGFIX-006 is complete.

**Plan:** Run `bun run test:e2e` after implementing BUGFIX-006. If `turn-timer.test.ts` still fails with a selector-related error, write BUGFIX-007 to fix the click syntax (replace with supported method, e.g., `evaluate()` + `element.click()` or `textContent` search).

---

## Sign-Off (Pending Implementation)

| Role | Status | Date |
|------|--------|------|
| Investigation | ✅ Complete (root cause identified, verified against code) | 2026-09-22 |
| Spec | ✅ Written and documented (this document) | 2026-09-22 |
| Implementation | ⏳ Pending (branch created, awaiting Task 2–5 execution) | — |
| Unit Testing | ⏳ Pending (Task 2 creates tests, Tasks 3–5 make them pass) | — |
| E2E Testing | ⏳ Pending (Task 6: user runs `bun run test:e2e` and reports results) | — |
| Code Review | ⏳ After implementation | — |
| Merge Ready | ⏳ After review + e2e pass | — |

---

## Related Documentation

- [`FEAT-004-E2E-TEST-FINDINGS.md`](../../FEAT-004-E2E-TEST-FINDINGS.md) — E2E test suite development and root-cause analysis (this bugfix resolves the identified gap)
- [`IMPLEMENTATION-GUIDE-URL-AUTOJOIN.md`](../../IMPLEMENTATION-GUIDE-URL-AUTOJOIN.md) — Quick implementation guide (superseded by this more thorough spec)
- [`docs/requirements/FEAT-004-e2e-ui-testing/`](../requirements/FEAT-004-e2e-ui-testing/) — E2E testing requirements and task breakdown
- [`docs/requirements/FEAT-003-session-ux-completion/`](../requirements/FEAT-003-session-ux-completion/) — Session UI features tested by e2e suite
