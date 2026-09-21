# FEAT-004 — End-to-End UI Testing with Bun WebView — Design

**Status:** Proposed (pending review)
**Source requirements:** [`requirements.md`](./requirements.md)

## 1. Problem Statement

FEAT-003 shipped client UI whose only verification was (a) pure-function
unit tests and (b) server-side wire-message tests. Neither layer mounts the
real component tree in a real browser. This let a component-mounting defect
(`RoomEditor`'s `connection` gate) and a stale-prop defect (`role`) ship
undetected — both are "state exists, but is never wired into what renders"
bugs, a class unit tests cannot catch by construction.

This feature adds a genuine e2e layer: `Bun.WebView` driving one or more
real headless browser tabs against a real running server + client, asserting
on actual DOM state.

## 2. Requirements Coverage

| Group | Requirements |
|-------|--------------|
| Harness | REQ-039, REQ-040, REQ-041 |
| Regression (motivating defects) | REQ-042, REQ-043 |
| Timer & driver visibility | REQ-044, REQ-045 |
| Driver selection & rotation | REQ-046, REQ-047 |
| Disconnect & grace period | REQ-048, REQ-049 |
| Control feedback & teardown | REQ-050, REQ-051, REQ-052 |
| Non-functional | NFR-013..017 |

## 3. Approved Technology Decisions

- **Browser automation: `Bun.WebView`, `backend: "chrome"`.** No Playwright,
  no Puppeteer, no new npm dependency — `Bun.WebView` ships in the Bun
  runtime already used everywhere else in this monorepo. The `"webkit"`
  backend is macOS-only and would make the suite non-portable to Linux
  CI/dev containers (confirmed: this environment is Linux and has no
  `WKWebView`); `"chrome"` works cross-platform and is explicitly the
  documented non-macOS default.
- **New workspace package: `packages/e2e`.** Kept separate from
  `packages/client` and `packages/server` so:
  - The browser-driving harness's devDependency-free approach doesn't bloat
    either app package.
  - `bun test packages/e2e` can be run/excluded independently of the fast
    unit suites (NFR-015 budget concern — these tests boot real servers and
    real browser subprocesses, an order of magnitude slower than in-memory
    unit tests).
  - It can freely import both `@codayon/server`'s bootstrapping pieces and
    `@codayon/client`'s built output without creating a dependency cycle
    between the two app packages themselves.
- **Server-under-test: real `Bun.serve`, ephemeral port, in-process.**
  Reuses `createAppWithDeps()` (already factored out in
  `packages/server/src/app.ts` for testability) and the same
  `createWebSocketHandler`/`tryUpgrade` wiring `index.ts` uses, but binds
  `port: 0` so the OS assigns a free port (REQ-039.1/4). This avoids a
  subprocess per test file and keeps failures easy to debug (same process,
  same stack traces) while still exercising the real HTTP+WS surface (not a
  mock).
- **Client-under-test: a single pre-built `vite build` output, served
  statically per test run.** Rather than booting a full Vite dev server per
  test (slow, HMR/websocket noise irrelevant here), the harness builds the
  client once (or reuses an existing `packages/client/dist` if present and
  fresh) and serves the static output with a tiny Bun static file server,
  configured so `/api` and `/ws` requests are reverse-proxied to that test's
  ephemeral server port — mirroring nginx's same-origin routing from
  FEAT-002, but implemented as a few lines of `Bun.serve` `fetch` glue
  instead of spinning up a real nginx container (keeps the harness fast and
  dependency-free; FEAT-002's nginx path itself is explicitly out of scope
  per requirements §1.4).
- **Per-test-file ephemeral ports + isolated harness instance (NFR-013).**
  Every test file boots its own server + static client server on port 0;
  nothing is shared across files. Within a file, multiple views can target
  the same room (REQ-040) by sharing that file's single harness instance.
- **Native input simulation only (NFR-016).** All simulated user actions
  (`view.click(selector)`, `view.type(text)`, `view.press(key)`) use
  `WebView`'s native dispatch, never `evaluate("document.querySelector(...).click()")`
  — the former fires `isTrusted: true` events identical to a real user and
  automatically waits for actionability; the latter would bypass the same
  event path FEAT-003's handlers are wired to and could pass against code
  that's broken for real users (which is exactly the failure mode this
  feature exists to prevent).
- **Assertions via `view.evaluate()` returning plain JSON-serializable
  values** (text content, boolean presence checks, counts) — never DOM
  node handles (which can't cross the `evaluate()` JSON boundary anyway).

## 4. Architecture

### 4.1 Package Layout

```
packages/e2e/
├── package.json          # devDependency-free; only @codayon/shared,
│                          # @codayon/server, @codayon/client as
│                          # workspace:* (for types + the built dist path)
├── tsconfig.json
└── src/
    ├── harness.ts         # boots server + static client server per test file
    ├── selectors.ts       # centralized CSS selectors for stable UI hooks
    ├── connection.test.ts       # REQ-042 (motivating defect regression)
    ├── role-confirmation.test.ts # REQ-043 (motivating defect regression)
    ├── turn-timer.test.ts       # REQ-044
    ├── driver-visibility.test.ts # REQ-045
    ├── manual-driver-picker.test.ts # REQ-046
    ├── rotation-order.test.ts   # REQ-047
    ├── grace-period.test.ts     # REQ-048
    ├── host-disconnect.test.ts  # REQ-049
    ├── control-rejection.test.ts # REQ-050
    ├── session-ended.test.ts    # REQ-051
    └── early-end-affordance.test.ts # REQ-052
```

### 4.2 Harness (`harness.ts`)

```typescript
export interface E2EHarness {
  readonly baseUrl: string;           // e.g. http://127.0.0.1:54231
  openView(): Promise<Bun.WebView>;   // pre-configured backend: "chrome"
  createRoom(input): Promise<{ code, hostToken, clientToken, hostId }>;
  close(): Promise<void>;             // tears down server + all opened views
}

export async function startHarness(): Promise<E2EHarness>;
```

Responsibilities:
- Boots the real server (`createAppWithDeps()` + `createWebSocketHandler` +
  `tryUpgrade`, same wiring as `packages/server/src/index.ts`) via
  `Bun.serve({ port: 0, fetch, websocket })`.
- Serves the client's built `dist/` via a second `Bun.serve` (also
  `port: 0`) whose `fetch` handler: serves static files for everything
  except `/api/*` and `/ws`, which it reverse-proxies (`fetch()` passthrough
  for `/api`, raw upgrade forwarding for `/ws`) to the first server's port —
  giving the browser one same-origin `baseUrl` to navigate to, exactly
  mirroring the same-origin contract FEAT-002's nginx provides in
  Docker Compose.
- Tracks every `WebView` it opens (`openView()`) so `close()` can guarantee
  teardown (REQ-039.3, REQ-040.3) even if a test fails mid-way — wrapped
  with `try/finally` in each test via `using`/`await using` per Bun's
  documented `Symbol.asyncDispose` support.
- `createRoom()`/room-join helpers wrap the same HTTP endpoints the real
  client calls (`POST /api/rooms`, `POST /api/rooms/:code/join`), so tests
  can set up room state without driving the lobby UI for every scenario,
  while still driving the UI (via views) for the actual assertions under
  test.

### 4.3 Selectors (`selectors.ts`)

FEAT-003's components currently have no `data-testid`-style hooks; tests
would otherwise depend on Tailwind classes or text content, which are
brittle. This feature adds minimal `data-testid` attributes to the specific
elements each requirement needs to assert on (e.g.
`data-testid="session-controls"`, `data-testid="turn-countdown"`,
`data-testid="current-driver"`, `data-testid="grace-period-banner"`,
`data-testid="host-disconnect-indicator"`) — additive attributes only, no
behavioral change to `SessionControls.tsx`/`RoomEditor.tsx`/etc. beyond the
`connection`/`role` bug fixes already applied. `selectors.ts` centralizes the
selector strings so a future markup refactor updates one file, not every
test.

### 4.4 Multi-View Room Flow (Representative Sequence, REQ-040/045)

```
harness.createRoom() -> { code, hostToken, clientToken: hostClientToken }
    |
    +-- hostView = harness.openView()
    |     hostView.navigate(`${baseUrl}/room/${code}?clientToken=...&role=host`)
    |
    +-- observerView = harness.openView()
    |     (drives the real join-by-code lobby UI, or uses a harness helper
    |      that calls POST /rooms/:code/join then navigates directly)
    |
hostView.click('[data-testid="configure-start-session"]')
hostView.click('[data-testid="start-turn-self"]')   // or manual driver pick
    |
    v (server broadcasts turnStarted to the whole room)
    |
assert: hostView DOM shows data-testid="current-driver" text === host name
        AND data-testid="you-are-driving" present
assert: observerView DOM shows data-testid="current-driver" text === SAME
        host name, AND "you-are-driving" ABSENT
```

### 4.5 Bug Fixes Landed With This Feature

Two defects identified in `requirements.md` §1.2 are fixed as the first
commits on this branch (before the harness/tests that would have caught
them, since a test suite built to catch a known bug should be demonstrated
against a codebase where that bug is actually fixed):

1. `RoomEditor.tsx`: `connection` converted from a plain `let` to
   `createSignal<RelayConnection | undefined>()`; every internal use
   (`onMessage`, `peerExtension`/`presenceExtension` construction,
   `onCleanup`'s `close()`, and the JSX mount guard) reads through the
   signal accessor so Solid's reactivity actually re-renders
   `SessionControls` once `connectRelay()` resolves.
2. `RoomEditor.tsx`: the `role`/`setRole` signal (already correctly updated
   from bootstrap + `RoleAssignedMsg` per REQ-035) is now actually passed to
   `SessionControls` (`role={role()}`) instead of the stale `props.role`
   initial prop, at both render sites.

REQ-042 and REQ-043's tests are the render-level regression coverage for
exactly these two fixes.

## 5. Testing Strategy

- **`connection.test.ts` (REQ-042):** navigate a single view into a room,
  wait for `data-testid="session-controls"` to become present with a
  bounded timeout, fail loudly (not skip) if it never appears.
- **`role-confirmation.test.ts` (REQ-043):** join as spectator, have the
  host (a second view) promote/reassign via a control action that changes
  the participant's role server-side, assert the spectator's own view's
  role-gated controls change without a reload.
- **`turn-timer.test.ts` (REQ-044):** start a short-duration turn, sample the
  countdown text twice a few seconds apart, assert it decreased; assert it's
  absent before any turn starts.
- **`driver-visibility.test.ts` (REQ-045):** two views, one turn, assert
  driver name text matches across both and the "you are driving" distinction
  is view-local.
- **`manual-driver-picker.test.ts` (REQ-046):** toggle selection policy
  manual vs. round-robin, host vs. non-host, turn-eligible vs. not; assert
  picker DOM presence/absence and its option list against roster.
- **`rotation-order.test.ts` (REQ-047):** round-robin session, assert
  rotation list DOM presence + next-up highlight; join a 4th participant
  mid-session, assert their name appears in the list after the next update.
- **`grace-period.test.ts` (REQ-048):** open a driver's view and close it
  (`view.close()`) mid-turn; assert the banner appears in remaining views
  and the host-only modal appears only in the host's view; resolve via the
  host's UI, assert the banner clears everywhere.
- **`host-disconnect.test.ts` (REQ-049):** close the host's view; assert the
  indicator appears in a remaining view without first opening the roster
  panel.
- **`control-rejection.test.ts` (REQ-050):** trigger a rejected action from
  a non-host view (e.g., attempt a host-only control), assert the banner
  text, then assert it's gone after the documented auto-dismiss window.
- **`session-ended.test.ts` (REQ-051):** host ends the session; assert the
  editor/controls are gone and a session-ended screen with a lobby-return
  control is present, in every open view.
- **`early-end-affordance.test.ts` (REQ-052):** driver in `fixed` (not
  `fixed-early-end`) mode; assert the early-end control is present, disabled,
  and carries explanatory text.

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| No Chrome-family browser present in a dev/CI environment (confirmed: this Linux dev environment currently has none installed) | REQ-041/NFR-017: fail loudly with Bun's own resolution error rather than skipping; document the dependency (README + this design doc) so it's an explicit, expected one-time setup step, not a surprise. |
| Flaky waits for async UI state | NFR-014: rely on `WebView`'s built-in actionability polling for `click()`/`scrollTo()`; for pure-text assertions (e.g. countdown value), poll `evaluate()` in a bounded loop rather than a fixed sleep. |
| e2e suite slows down the default `bun test` run | Kept as its own workspace package; root `package.json` gets a separate `test:e2e` script so the fast unit suites remain the default `bun test` experience, while `bun test packages/e2e` (or `bun run test:e2e`) opts in explicitly. |
| Selector brittleness (Tailwind classes churn) | `data-testid` attributes added specifically for this feature's assertions, centralized in `selectors.ts` (§4.3). |
| Static client build going stale relative to source during local iteration | Harness rebuilds (`vite build`) at `startHarness()` time by default; a future optimization (not required for this feature) could cache by source hash, but correctness-over-speed is the right default for a new test suite. |
| Two defects in `requirements.md` §1.2 could regress again silently if only fixed but never covered | REQ-042/REQ-043 exist specifically so these two defects have permanent render-level regression coverage, not just a one-time manual fix. |
