# FEAT-004 — End-to-End UI Testing with Bun WebView

## 1. Introduction

### 1.1 Product Context

FEAT-003 added a substantial amount of client render logic — turn
countdowns, driver/rotation displays, grace-period modals, rejection
banners, session-ended teardown — layered on top of FEAT-001's
collaboration backbone. All of this logic was verified by:

- Pure unit tests on formatting/derivation helpers (e.g.
  `countdown.test.ts`, `rotation-order.test.ts`), and
- Server-side integration tests (`ws.test.ts`, `e2e.test.ts`) that assert on
  wire messages, never on rendered DOM.

**No test in the suite ever mounts the real `RoomEditor`/`SessionControls`
component tree in a real browser and asserts on what a user would actually
see.** This gap let a real, user-facing regression ship in FEAT-003 (see
§1.2) that every existing test suite passed against.

### 1.2 Motivating Defect

`packages/client/src/components/RoomEditor.tsx` declared its WebSocket
connection as a plain local variable:

```ts
let connection: RelayConnection | undefined;
// ...
onMount(async () => {
  connection = await connectRelay({ ... }); // assigned asynchronously
  // ...
});
```

and gated the entire `SessionControls` panel on it directly in JSX:

```tsx
{connection && <SessionControls ... />}
```

SolidJS's reactivity system has no way to observe a plain `let` reassignment.
The JSX expression evaluates exactly once, synchronously, during the
component's initial render — at which point `connection` is still
`undefined` — and never re-evaluates once `connectRelay()` resolves.
**`SessionControls` — and therefore every FEAT-003 UI surface it hosts
(timer, driver badge, rotation order, grace-period banner, rejection
banner, manual driver picker, host-disconnect indicator) — never rendered
for any user, in any session, ever**, despite:

- All server-side logic working correctly (verified by `ws.test.ts`).
- All client-side unit tests passing (they test helper functions in
  isolation, never the mount).
- `bun run typecheck` and `vite build` succeeding (the bug is a runtime
  reactivity defect, not a type error).

A second, related defect was found in the same file: a `role`/`setRole`
signal was introduced (REQ-035, "server-confirmed role is authoritative")
and correctly updated from `RoleAssignedMsg`, but `SessionControls` was
still passed the original `props.role` prop in both render sites — so the
tracked signal was computed and never read. `tsc --noEmit` flagged this as
an unused-variable warning, but nothing enforced it as a test failure.

Both defects share a root cause: **state is tracked, but never verified to
be wired into what's actually rendered.** Unit tests over pure functions and
server messages cannot catch this class of bug by construction — only a
test that renders the real component tree in a real browser and reads the
DOM can.

### 1.3 In Scope

- A dedicated, isolated test package (`packages/e2e`) using `Bun.WebView`
  (native to the Bun runtime, no Playwright/Puppeteer dependency) to drive a
  real browser against a real running instance of the server + client.
- A minimal test harness: spin up the server (in-process or subprocess) and
  the client (`vite build` + a static server, or `vite` dev server) on
  ephemeral ports per test run, so tests are hermetic and parallelizable.
- Multi-view scenarios: tests that open **multiple concurrent `WebView`
  instances** against the same room to assert cross-client convergence (the
  thing unit tests structurally cannot do), e.g. "host starts a turn → both
  the host's and the observer's views show the same driver name."
- Coverage of the specific FEAT-003 UI surfaces that had zero
  render-level verification before this feature:
  - `SessionControls` mounts at all once the relay connects (regression
    test for the motivating defect, §1.2).
  - Turn countdown is visible and decrements.
  - Current driver name and turn number are visible and match across views.
  - Manual driver picker appears/disappears under the correct conditions.
  - Rotation order list appears/disappears and highlights next-up.
  - Grace-period banner (all participants) and modal (host only) appear on
    disconnect and clear on resolution.
  - Host-disconnect indicator appears/clears independent of the roster
    panel being open.
  - Role-gated controls reflect the **server-confirmed** role, including
    after a role change/reconnect (regression test for the second defect,
    §1.2).
  - Control-rejection banner renders human-readable text and auto-dismisses.
  - Session-ended view replaces the live editor and offers a lobby return.
  - Early-end button's disabled/explained state.
- A `bun test` -compatible entry point (`bun test packages/e2e`) so these
  tests run alongside the existing unit/integration suites, plus a separate
  npm script (`test:e2e`) since browser-driven tests are slower and may need
  to be run less frequently (e.g. pre-merge, not on every save).
- CI/local documentation of the Chrome/Chromium dependency this feature
  introduces (Bun's non-macOS `WebView` backend requires a Chrome-family
  browser to be present — see NFR-004).

### 1.4 Out of Scope (deferred to future specifications)

- **Visual regression testing** (pixel-diffing screenshots). `WebView`
  supports `screenshot()`, but establishing a golden-image baseline/diffing
  pipeline is a separate concern from behavioral e2e coverage and not
  required to close FEAT-003's gap.
- **Cross-browser matrix testing** (WebKit vs. Chrome backends, multiple
  Chrome versions). This feature targets one backend (`"chrome"`, since the
  target deployment and most CI runners are Linux) as a starting point;
  broader matrix testing is future work.
- **Load/soak/performance testing** via WebView (e.g. dozens of concurrent
  simulated browser sessions). This feature's multi-view tests are for
  *correctness* (2-4 views), not scale.
- **Retrofitting every existing FEAT-001/002/003 requirement with a
  browser-driven test.** This feature closes the specific FEAT-003
  render-verification gap and establishes the harness/pattern; exhaustive
  e2e coverage of all prior requirements is not mandated as one slice (see
  `tasks.md` for the prioritized subset actually covered).
- **Testing the Docker Compose stack itself** (FEAT-002). This feature runs
  the server/client directly via Bun/Vite for speed and isolation, not
  through `docker compose up`.

---

## 2. Glossary

| Term | Definition |
|------|------------|
| **View** | One `Bun.WebView` instance — a single, independent headless browser tab/page, analogous to one user's browser tab in a real session. |
| **Harness** | The test-support code that boots a real server instance and a real client build on ephemeral ports, and exposes helpers to create rooms/join/navigate views against them. |
| **Render-level test** | A test that asserts on the actual rendered DOM/UI state (via `view.evaluate()`, `view.click()`, selector waits) rather than on wire messages or pure function output. |
| **Actionable (element)** | Per Bun's `WebView` semantics: attached to the DOM, non-zero bounding box, in-viewport, stable for two animation frames, and not obscured — the precondition `click()`/`scrollTo()` wait for automatically. |

---

## 3. Requirements

### 3.1 Test Harness

#### REQ-039 — Hermetic per-test server + client instances
**User story:** As a test author, I want each e2e test to run against its
own isolated server + client instance, so that tests don't interfere with
each other or leak state across runs.

Acceptance criteria:
1. WHEN an e2e test starts, THE HARNESS SHALL boot a server instance bound
   to an ephemeral, unused port.
2. WHEN an e2e test starts, THE HARNESS SHALL make a client build available
   to the browser (statically served or dev-served) configured to reach
   that test's server instance.
3. WHEN an e2e test finishes (pass or fail), THE HARNESS SHALL tear down its
   server instance and close all `WebView` instances it opened.
4. THE HARNESS SHALL NOT require a fixed, hardcoded port shared across test
   files (to allow parallel test execution without collision).

#### REQ-040 — Multi-view room scenarios
**User story:** As a test author, I want to open multiple independent
browser views against the same room, so that I can assert cross-client
convergence the way unit tests cannot.

Acceptance criteria:
1. THE HARNESS SHALL provide a way to open N independent `WebView` instances
   that each join the same room (as host, observer, or spectator).
2. WHEN one view performs an action that the server broadcasts to the room
   (e.g., starting a turn), THE TEST SHALL be able to assert that the
   resulting UI state is visible in every other open view for that room.
3. THE HARNESS SHALL close all views associated with a test at teardown,
   independent of how many were opened.

#### REQ-041 — CI/local environment documentation for the browser dependency
**User story:** As a contributor, I want to know what browser dependency
this feature requires and how to satisfy it, so that e2e tests don't fail
mysteriously in a fresh environment.

Acceptance criteria:
1. THE PROJECT SHALL document, in a location a contributor running e2e
   tests for the first time would see, that the Chrome backend requires a
   Chrome/Chromium/Edge/Brave executable discoverable per Bun's resolution
   order (see NFR-004).
2. IF the required browser executable is not found, THEN THE TEST SUITE
   SHALL fail with an error that surfaces Bun's own "could not find a
   Chrome executable" message (i.e., the harness SHALL NOT swallow or
   obscure this failure).

### 3.2 Regression Coverage (Motivating Defect)

#### REQ-042 — SessionControls mounts once the relay connects
**User story:** As a participant, I want the session control panel to
actually appear once I've joined a room, so that the FEAT-003 defect (panel
silently never rendering) cannot silently reoccur.

Acceptance criteria:
1. WHEN a view navigates to a room and the client establishes its relay
   connection, THE TEST SHALL assert that the session-controls DOM subtree
   becomes present within a bounded wait.
2. THE TEST SHALL fail (not silently pass) if the relay connection resolves
   but the session-controls subtree never appears — reproducing the exact
   failure mode described in `requirements.md` §1.2 if it recurs.

#### REQ-043 — Role-gated UI reflects server-confirmed role, not the stale prop
**User story:** As a participant whose role changes mid-session, I want the
UI's host/observer/spectator-gated controls to reflect my current,
server-confirmed role, so that the second FEAT-003 defect (UI wired to the
stale initial prop instead of the updated signal) cannot silently reoccur.

Acceptance criteria:
1. WHEN the server sends a role-assignment message with a role different
   from the view's initial join role, THE TEST SHALL assert that
   role-gated controls (e.g., host-only buttons) update accordingly in the
   rendered DOM, without a page reload.

### 3.3 Turn Timer & Driver Visibility (Render-Level)

#### REQ-044 — Turn countdown is visible and live
**User story:** As a participant, I want to see the turn countdown actually
rendered and changing over time, not just the underlying signal computed
correctly in isolation.

Acceptance criteria:
1. WHILE a turn is active, THE TEST SHALL assert the countdown text is
   present in the DOM.
2. THE TEST SHALL assert the displayed countdown value decreases between
   two samples taken several seconds apart.
3. WHEN no turn is active, THE TEST SHALL assert no stale countdown value
   remains visible.

#### REQ-045 — Current driver and turn number are visible and consistent across views
**User story:** As a participant, I want to see who's driving and the turn
number, and I want every participant's view to agree, not just my own.

Acceptance criteria:
1. WHILE a turn is active, THE TEST SHALL assert the current driver's name
   is present in the DOM of every open view for that room.
2. THE TEST SHALL assert the driving participant's own view is visually
   distinguished (e.g., a "You are driving" indicator) from how the same
   turn is displayed in a non-driving participant's view.

### 3.4 Driver Selection & Rotation (Render-Level)

#### REQ-046 — Manual driver picker visibility conditions
**User story:** As a host under manual selection, I want the driver picker
to actually appear in the DOM under the right conditions and only then.

Acceptance criteria:
1. WHEN the session is configured for manual selection AND the local view is
   the host AND eligible to start a turn, THE TEST SHALL assert the driver
   picker control is present and its options match the connected,
   non-spectator roster.
2. WHEN any of those conditions is false, THE TEST SHALL assert the picker
   is absent from the DOM.

#### REQ-047 — Rotation order visibility conditions
**User story:** As a participant under round-robin selection, I want the
rotation order list to actually appear and reflect fair insertion.

Acceptance criteria:
1. WHEN the session uses round-robin selection AND is active, THE TEST
   SHALL assert the rendered rotation order list is present and the
   next-up entry is visually highlighted.
2. WHEN a new participant joins mid-session, THE TEST SHALL assert their
   name appears in the rendered rotation list after the next update.

### 3.5 Disconnect & Grace Period (Render-Level)

#### REQ-048 — Grace-period banner and host modal
**User story:** As a participant, I want to see the grace-period banner
render for everyone, and the host to see actionable controls, matching
FEAT-003's design — not just the underlying message being sent correctly.

Acceptance criteria:
1. WHEN a driver's view is closed mid-turn, THE TEST SHALL assert a
   grace-period banner becomes visible in the DOM of every remaining open
   view for that room.
2. THE TEST SHALL assert the host's view additionally renders
   reassign/extend/skip controls, and a non-host view does not.
3. WHEN the host resolves the grace period, THE TEST SHALL assert the
   banner is removed from the DOM of every remaining view.

#### REQ-049 — Host-disconnect indicator visibility
**User story:** As a participant, I want the host-disconnect indicator to
actually be visible without opening the roster panel, matching FEAT-003's
design.

Acceptance criteria:
1. WHEN the view representing the host is closed, THE TEST SHALL assert a
   host-disconnect indicator becomes visible in a remaining view's DOM
   without first interacting with any roster-toggle control.

### 3.6 Control Feedback & Teardown (Render-Level)

#### REQ-050 — Control-rejection banner render and auto-dismiss
**User story:** As a user whose action was rejected, I want to see the
rejection actually rendered in plain language and then disappear on its
own.

Acceptance criteria:
1. WHEN a control action is rejected for the local view's user, THE TEST
   SHALL assert a human-readable rejection message becomes visible in the
   DOM.
2. THE TEST SHALL assert the message is no longer present after the
   documented auto-dismiss window elapses.

#### REQ-051 — Session-ended view replaces the live editor
**User story:** As a participant, I want the live editor to actually be
replaced by a distinct ended-state screen, not just a `sessionEnded` signal
being set internally.

Acceptance criteria:
1. WHEN the host ends the session, THE TEST SHALL assert that, in every
   open view for that room, the editor/host/driver controls are no longer
   present in the DOM and a session-ended screen with a return-to-lobby
   control is present instead.

#### REQ-052 — Early-end ineligibility affordance renders as disabled, not absent
**User story:** As a driver in a mode that disallows early-end, I want to
see the control present but disabled with an explanation, not simply
missing.

Acceptance criteria:
1. WHEN the local view is the current driver AND the turn mode does not
   permit early-end, THE TEST SHALL assert an early-end control is present
   in the DOM, in a disabled state, with explanatory text — not absent.

---

## 4. Non-Functional Requirements

- **NFR-013 (Test isolation):** e2e tests SHALL NOT share mutable server
  state across test files; each test (or test file, at minimum) SHALL use
  its own server instance and port (REQ-039).
- **NFR-014 (Bounded wait, no arbitrary sleeps):** Assertions on
  asynchronous UI state (e.g., "the banner appears") SHALL use bounded
  polling/actionability waits (as `WebView.click()`/`scrollTo()` already do
  natively) rather than fixed `setTimeout` sleeps, to keep the suite fast
  and avoid flakiness from under- or over-waiting.
- **NFR-015 (CI runtime budget):** The full e2e suite introduced by this
  feature SHOULD complete in well under a few minutes on CI hardware,
  given the tests are correctness checks over a handful of views, not a
  load test (informs backend choice and harness design, not a hard gate).
- **NFR-016 (Native input fidelity):** Interactions that simulate user
  input (clicks, typing, key presses) SHALL use `WebView`'s native input
  simulation methods (`click()`, `type()`, `press()`) rather than
  `evaluate()`-based DOM manipulation, so tests exercise the same event
  path (`isTrusted: true`) a real user would trigger.
- **NFR-017 (Documented browser dependency, no silent skip):** The suite
  SHALL NOT silently skip or no-op when no Chrome-family browser is
  present (REQ-041.2) — a missing browser is a hard failure with a clear
  message, not a soft-pass.

---

## 5. Traceability

| Requirement | Origin | Related FEAT-003 Requirements |
|---|---|---|
| REQ-039, REQ-040, REQ-041 | Harness foundation | — |
| REQ-042 | Motivating defect (§1.2, `connection` non-reactivity) | — |
| REQ-043 | Motivating defect (§1.2, stale `role` prop) | REQ-035 |
| REQ-044 | Render-verification gap | REQ-027 |
| REQ-045 | Render-verification gap | REQ-028, REQ-029 |
| REQ-046 | Render-verification gap | REQ-030 |
| REQ-047 | Render-verification gap | REQ-031 |
| REQ-048 | Render-verification gap | REQ-032, REQ-033 |
| REQ-049 | Render-verification gap | REQ-034 |
| REQ-050 | Render-verification gap | REQ-036 |
| REQ-051 | Render-verification gap | REQ-037 |
| REQ-052 | Render-verification gap | REQ-038 |

---

## 6. Relationship to Prior Work

This feature does not modify FEAT-001/002/003 requirements or behavior. It
adds a new verification layer on top of the client UI FEAT-003 built, and
fixes the two defects FEAT-003 shipped undetected (§1.2) as its first
commits — both as a concrete demonstration of the gap this feature closes,
and because leaving a known, user-facing "the controls never render" bug
unfixed while building a test suite to detect exactly that bug would be
self-defeating.
