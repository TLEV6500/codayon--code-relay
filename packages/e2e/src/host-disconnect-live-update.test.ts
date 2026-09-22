import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startHarness, type E2EHarness } from "./harness";
import { selectors } from "./selectors";
import { waitForSelector } from "./test-helpers";

/**
 * GAP-DOCUMENTATION TEST (EXPECTED TO FAIL) — Host disconnect does not
 * live-update the observer's host-disconnect indicator.
 *
 * See docs/bugfixes/GAPS-duplicate-names-host-disconnect-rejoin.md (Gap 2)
 * for full root-cause analysis. This is the end-to-end/browser-level proof
 * of the same gap covered at the unit/WS level in
 * packages/server/src/ws.host-disconnect-broadcast.test.ts.
 *
 * ws.ts's close() handler never calls broadcastSessionState() for a plain
 * (non-driver) disconnect, so the observer's SessionControls never receives
 * an updated roster and [data-testid="host-disconnect-indicator"] never
 * mounts, no matter how long we wait.
 *
 * THIS TEST IS EXPECTED TO FAIL/TIME OUT. The failure IS the documentation
 * of the bug. No production code (ws.ts, RoomEditor.tsx, SessionControls.tsx)
 * is modified here, per explicit product decision.
 */
describe("GAP — host disconnect does not live-update observer's indicator", () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("observer's host-disconnect-indicator should appear shortly after the host view closes", async () => {
    try {
      const room = await harness.createRoom();
      const hostView = await harness.openView();
      const obsView = await harness.openView();

      await hostView.navigate(
        `${harness.baseUrl}/room/${room.code}?clientToken=${room.hostClientToken}`,
      );

      // Wait for the host connection to establish before opening the
      // observer view (see turn-timer.test.ts / role-confirmation.test.ts —
      // Bun WebView needs this gap to avoid flaky connection races).
      await new Promise((r) => setTimeout(r, 2000));

      await obsView.navigate(
        `${harness.baseUrl}/room/${room.code}?clientToken=${room.observerClientToken}`,
      );

      // Both views' SessionControls must be mounted before we can trust the
      // indicator's absence/presence means anything. Note: this harness has
      // a known pre-existing intermittent connection-establishment race
      // (see e2e/turn-timer.test.ts, role-confirmation.test.ts history) that
      // is unrelated to the gap under test here. To keep this test focused
      // on documenting Gap 2 rather than that separate flake, we retry the
      // connection check once before treating it as a genuine setup failure.
      async function waitForControlsWithRetry(view: Bun.WebView): Promise<boolean> {
        let loaded = await waitForSelector(view, selectors.sessionControls, {
          timeoutMs: 5000,
          pollIntervalMs: 100,
        });
        if (!loaded) {
          // One retry after a short backoff — harness connection races are
          // transient, not indicative of the gap being tested here.
          await new Promise((r) => setTimeout(r, 1000));
          loaded = await waitForSelector(view, selectors.sessionControls, {
            timeoutMs: 3000,
            pollIntervalMs: 100,
          });
        }
        return loaded;
      }

      const hostControlsLoaded = await waitForControlsWithRetry(hostView);
      expect(hostControlsLoaded).toBe(true);

      const obsControlsLoaded = await waitForControlsWithRetry(obsView);
      expect(obsControlsLoaded).toBe(true);

      // Sanity check: indicator is absent while the host is still connected.
      const indicatorBefore = await waitForSelector(
        obsView,
        selectors.hostDisconnectIndicator,
        { timeoutMs: 500, pollIntervalMs: 100 },
      );
      expect(indicatorBefore).toBe(false);

      // Host disconnects.
      hostView.close();

      // Poll the observer's view for the indicator to appear. Per the bug,
      // no sessionSnapshot ever arrives, so this should time out and return
      // false — proving the observer's UI never learns the host left.
      const indicatorAfter = await waitForSelector(
        obsView,
        selectors.hostDisconnectIndicator,
        { timeoutMs: 2000, pollIntervalMs: 100 },
      );

      // EXPECTED TO FAIL: `indicatorAfter` will be `false` (timed out),
      // not `true`, because the observer's roster is never updated.
      expect(indicatorAfter).toBe(true);

      obsView.close();
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      if (
        err.includes("Failed to spawn Chrome") ||
        err.includes("could not find a Chrome executable")
      ) {
        console.log(
          "Skipping WebView test: Chrome/Chromium not found. Install Chrome or set BUN_CHROME_PATH.",
        );
        return;
      }
      throw e;
    }
  });
});
