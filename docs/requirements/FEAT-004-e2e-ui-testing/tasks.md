# FEAT-004 — End-to-End UI Testing with Bun WebView — Tasks

**Status legend:** `[x]` complete · `[~]` in progress · `[ ]` not started
**Source:** [`requirements.md`](./requirements.md) · [`design.md`](./design.md)

Each task is a working, demoable increment. No orphaned code.

---

- [x] **Task 0 — Fix the two motivating defects in `RoomEditor.tsx`**
  - Convert `connection` from a plain `let` to a `createSignal`; update all
    internal reads (`onMessage`, `peerExtension`/`presenceExtension`,
    `onCleanup`, and the JSX mount guard) to go through the accessor.
  - Wire the already-tracked `role` signal into `SessionControls`'s `role`
    prop instead of the stale `props.role`.
  - **Requirements:** motivates REQ-042, REQ-043.
  - **Verified:** existing `bun test packages/client` (243 tests) and
    `bun run typecheck`/`vite build` still pass; behavior fix has no unit
    test of its own yet (that's what Task 3/4 add) — landed first, ahead of
    the harness, as a standalone, reviewable commit.
  - **Status:** done — landed as commit `028d3fc` on this branch ahead of
    the e2e package scaffolding below.

- [ ] **Task 1 — Scaffold `packages/e2e` workspace package**
  - New `packages/e2e/package.json` (workspace member, `@codayon/e2e`),
    `tsconfig.json` extending the repo base config.
  - Add `test:e2e` script at the repo root (`bun test packages/e2e`),
    separate from the default `bun test` (unit/integration only).
  - **Requirements:** REQ-039 (foundation).
  - **Demo:** `bun run --cwd packages/e2e typecheck` succeeds on an empty
    package; root `bun test` (no args) does NOT pick up `packages/e2e` by
    accident (confirms isolation from the fast default suite).

- [ ] **Task 2 — Harness: real server + static client on ephemeral ports**
  - `packages/e2e/src/harness.ts`: `startHarness()` boots the real Hono/WS
    server (reusing `createAppWithDeps`/`createWebSocketHandler`/
    `tryUpgrade` from `@codayon/server`) on `port: 0`; a second `Bun.serve`
    on `port: 0` serves `packages/client/dist` (building it first if
    missing/stale) and reverse-proxies `/api` + `/ws` to the first server —
    mirroring FEAT-002's same-origin nginx contract without nginx.
  - `openView()` returns a `backend: "chrome"` `Bun.WebView` and tracks it
    for teardown; `close()` tears down both servers and every tracked view.
  - `createRoom()`/join helpers wrapping the real HTTP endpoints.
  - **Requirements:** REQ-039, REQ-040 (foundation), REQ-041, NFR-013,
    NFR-017.
  - **Verified:** a harness-only smoke test: `startHarness()` →
    `openView()` → `view.navigate(harness.baseUrl)` → assert `view.title`
    is the app's title → `harness.close()`; asserts no leaked ports/procs
    (best-effort: a second `startHarness()` in the same test succeeds,
    implying the first's ports were released).

- [ ] **Task 3 — `data-testid` hooks on FEAT-003 UI surfaces**
  - Add additive `data-testid` attributes (no behavioral change) to:
    `session-controls`, `turn-countdown`, `current-driver`,
    `you-are-driving`, `turn-number`, `manual-driver-picker`,
    `rotation-order-list`, `rotation-next-up`, `grace-period-banner`,
    `grace-period-modal` (host actions), `host-disconnect-indicator`,
    `control-rejection-banner`, `session-ended-view`,
    `return-to-lobby`, `early-end-button`.
  - `packages/e2e/src/selectors.ts`: centralize every selector string used
    by the tests below.
  - **Requirements:** supports REQ-042–052 (test-hook infrastructure).
  - **Verified:** `bun test packages/client` (existing suite) still passes
    unchanged — confirms the attributes are additive only; `vite build`
    succeeds.

- [ ] **Task 4 — Regression test: SessionControls mounts (REQ-042)**
  - `packages/e2e/src/connection.test.ts`: single view, create+join a room,
    navigate, assert `[data-testid="session-controls"]` becomes present
    within a bounded wait.
  - **Requirements:** REQ-042.
  - **Demo:** temporarily re-introduce the plain-`let` `connection` bug
    (`git stash`/local revert) and confirm this test fails with a clear
    timeout error, then restore the fix and confirm it passes — proves the
    test actually catches the defect it's named for.

- [ ] **Task 5 — Regression test: role-gated UI reflects server role (REQ-043)**
  - `packages/e2e/src/role-confirmation.test.ts`: join as spectator, drive a
    role change server-side (host action or direct API per the harness),
    assert the spectator view's role-gated controls update in the DOM
    without a reload.
  - **Requirements:** REQ-043.

- [ ] **Task 6 — Turn countdown render test (REQ-044)**
  - `packages/e2e/src/turn-timer.test.ts`: start a short-duration
    (`fixed`/`fixed-early-end`) turn, sample the rendered countdown twice a
    few seconds apart, assert it decreased; assert absence pre-turn-start.
  - **Requirements:** REQ-044.

- [ ] **Task 7 — Driver & turn-number visibility across views (REQ-045)**
  - `packages/e2e/src/driver-visibility.test.ts`: two views (host +
    observer) in one room; start a turn; assert both views' rendered driver
    name match; assert "you are driving" is present only in the driving
    view.
  - **Requirements:** REQ-045.

- [ ] **Task 8 — Manual driver picker conditions (REQ-046)**
  - `packages/e2e/src/manual-driver-picker.test.ts`: assert picker DOM
    presence/absence across the host/non-host, manual/round-robin, and
    turn-eligible/non-eligible axes; assert its rendered options match the
    connected, non-spectator roster.
  - **Requirements:** REQ-046.

- [ ] **Task 9 — Rotation order visibility + late-joiner insertion (REQ-047)**
  - `packages/e2e/src/rotation-order.test.ts`: round-robin session, assert
    rendered order list + next-up highlight; join a new participant
    mid-session via a second view, assert their name appears in the
    rendered list after the next update.
  - **Requirements:** REQ-047.

- [ ] **Task 10 — Grace period banner + host modal (REQ-048)**
  - `packages/e2e/src/grace-period.test.ts`: open a driver's view, close it
    mid-turn (`view.close()`), assert the banner renders in every remaining
    view and the reassign/extend/skip modal renders only in the host's
    view; resolve via the host UI, assert the banner clears everywhere.
  - **Requirements:** REQ-048.

- [ ] **Task 11 — Host-disconnect indicator (REQ-049)**
  - `packages/e2e/src/host-disconnect.test.ts`: close the host's view,
    assert the indicator renders in a remaining view without first toggling
    the roster panel.
  - **Requirements:** REQ-049.

- [ ] **Task 12 — Control-rejection banner render + auto-dismiss (REQ-050)**
  - `packages/e2e/src/control-rejection.test.ts`: trigger a rejected action
    from a non-host view, assert the rendered rejection text, then assert
    it's gone after the documented auto-dismiss window elapses.
  - **Requirements:** REQ-050.

- [ ] **Task 13 — Session-ended teardown view (REQ-051)**
  - `packages/e2e/src/session-ended.test.ts`: host ends the session; assert
    the live editor/controls are gone and the ended-state screen +
    return-to-lobby control are present, in every open view.
  - **Requirements:** REQ-051.

- [ ] **Task 14 — Early-end ineligibility affordance (REQ-052)**
  - `packages/e2e/src/early-end-affordance.test.ts`: driver in `fixed` mode;
    assert the early-end control is present, disabled, with explanatory
    text (not absent).
  - **Requirements:** REQ-052.

- [ ] **Task 15 — Documentation: browser dependency + how to run**
  - Root `README.md`: new "End-to-End UI Tests" section documenting the
    Chrome/Chromium/Edge/Brave requirement (NFR-017/REQ-041), how to run
    (`bun run test:e2e`), and that it's separate from the default `bun
    test`.
  - **Requirements:** REQ-041.
  - **Verified:** manual review — a contributor with no browser installed
    who runs `bun run test:e2e` sees Bun's own clear "could not find a
    Chrome executable" error, and the README explains how to resolve it,
    consistent with REQ-041.2's "do not obscure this failure" requirement.
