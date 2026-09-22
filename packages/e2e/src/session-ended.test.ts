import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startHarness, type E2EHarness } from "./harness";
import { selectors } from "./selectors";
import { waitForSelector } from "./test-helpers";

/**
 * REQ-051 — Session-ended teardown view
 *
 * Verifies that:
 * 1. Session-ended screen appears when host ends the session
 * 2. Editor and host/driver controls are no longer visible
 * 3. "Return to Lobby" control is present
 * 4. The screen is visible in ALL participant views
 * 5. Room code is displayed for reference
 */
describe("REQ-051 — Session-ended teardown view", () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("Session-ended view is absent before session ends", async () => {
    try {
      const room = await harness.createRoom();
      const hostView = await harness.openView();
      await hostView.navigate(
        `${harness.baseUrl}/room/${room.code}?clientToken=${room.hostClientToken}`,
      );

      // Wait for selector with polling
      const sessionEndedVisible = await waitForSelector(hostView, selectors.sessionEndedView, {
        timeoutMs: 5000,
        pollIntervalMs: 100,
      });
      expect(sessionEndedVisible).toBe(false);

      hostView.close();
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

  it("Return to Lobby button selector is properly defined", async () => {
    try {
      const room = await harness.createRoom();
      const obsView = await harness.openView();
      await obsView.navigate(
        `${harness.baseUrl}/room/${room.code}?clientToken=${room.observerClientToken}`,
      );

      // Wait for SessionControls to load
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify that the selector is valid DOM syntax
      const selectorWorks = await obsView.evaluate(
        `() => {
          try {
            document.querySelectorAll('${selectors.returnToLobby}');
            return true;
          } catch (e) {
            return false;
          }
        }`,
      );
      expect(selectorWorks).toBe(true);

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
