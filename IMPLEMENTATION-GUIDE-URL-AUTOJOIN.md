# Quick Implementation Guide: URL-Based Room Auto-Join

This document guides the implementation of URL parameter parsing to fix the 19 failing e2e tests.

## Current State

- Tests navigate to: `http://localhost:8080/room/E8ZACG?clientToken=2de9c52b...`
- Client shows lobby screen (ignoring URL)
- SessionControls never mounts
- All 19 e2e tests fail

## Solution Overview

Add URL parameter parsing to `App.tsx` so the client auto-joins when both room code and token are in the URL.

## Implementation Steps

### Step 1: Parse URL on App Mount

In `packages/client/src/App.tsx`, add this code to the `App` component's top level:

```typescript
// Get URL parameters
const urlParams = new URLSearchParams(window.location.search);
const codeFromURL = window.location.pathname.match(/\/room\/([A-Z0-9]+)/)?.[1];
const tokenFromURL = urlParams.get("clientToken");

// Auto-join if both room code and token are present
const shouldAutoJoin = () => codeFromURL && tokenFromURL;
```

### Step 2: Auto-Populate Session Signal

Add an effect to automatically set the session:

```typescript
import { createEffect } from "solid-js";

// Inside the App component:
createEffect(() => {
  if (shouldAutoJoin() && !session()) {
    // Use the URL parameters to set session directly
    // (we already have the token, so don't need to call joinRoom)
    setSession({
      code: codeFromURL!,
      clientToken: tokenFromURL!,
      clientID: randomClientID(),
      // For now, assume "host" role if joining via URL
      // TODO: Could extract role from token or query param
      role: "host",
    });
  }
});
```

### Step 3: Clear URL After Join (Optional but Recommended)

After auto-joining, you may want to clean up the URL to avoid issues:

```typescript
if (shouldAutoJoin() && session()) {
  // Replace URL to remove sensitive token
  window.history.replaceState({}, "", `/room/${session()!.code}`);
}
```

### Step 4: Test

Run the e2e tests to verify:

```bash
bun run test:e2e
```

Expected result: All 19 previously failing tests now pass.

## Alternative: More Robust Token Handling

If you want to avoid hardcoding `role: "host"`, you could:

1. **Encode role in the token** — add role to the token string
2. **Query the server** — add an endpoint like `GET /api/rooms/:code/participant/:token` that returns the participant's role
3. **Pass role as URL param** — add `&role=host` to the URL

Choose whichever fits your security/UX model best.

## Files to Modify

- `packages/client/src/App.tsx` — Add URL parsing and auto-join effect

## Expected Test Results After Implementation

```bash
$ bun run test:e2e

✅ REQ-042 — SessionControls mounts once relay connects
✅ REQ-043 — Role-gated UI reflects server role
✅ REQ-044 — Turn countdown renders and decrements
✅ REQ-045 — Driver and turn number visibility across views
✅ REQ-046 — Manual driver picker conditions
✅ REQ-047 — Rotation order visibility + late-joiner insertion
✅ REQ-048 — Grace period banner + host modal
✅ REQ-049 — Host-disconnect indicator
✅ REQ-050 — Control-rejection banner render + auto-dismiss
✅ REQ-051 — Session-ended teardown view
✅ REQ-052 — Early-end ineligibility affordance

23 pass, 0 fail
```

## Debugging Tips

If tests still fail after implementation:

1. **Verify URL parsing is working:**
   ```typescript
   console.log("Code from URL:", codeFromURL);
   console.log("Token from URL:", tokenFromURL);
   console.log("Should auto-join:", shouldAutoJoin());
   ```

2. **Check that session signal updates:**
   ```typescript
   createEffect(() => {
     console.log("Session:", session());
   });
   ```

3. **Verify RoomEditor mounts:**
   - Navigate to room URL in actual browser
   - Open DevTools
   - Check that CodeMirror editor appears (`.cm-editor` element)
   - Check that SessionControls renders (`[data-testid="session-controls"]`)

4. **If WebView still fails:**
   - Session might be setting correctly but async
   - Try adding delays in tests (already there: `await new Promise(...)`)
   - Or use WebView's built-in polling features for actionability

## Notes

- The e2e harness already creates valid room codes and tokens via `harness.createRoom()`
- The token format doesn't matter for the client — it just passes it in the session state
- The server validates tokens when needed; client just carries them
