import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startHarness, type E2EHarness } from "./harness";
import { selectors } from "./selectors";

/**
 * REQ-042 — SessionControls mounts once the relay connects
 *
 * Regression test for the motivating defect in FEAT-004:
 * The RoomEditor.tsx used a plain `let connection` which was invisible to
 * SolidJS reactivity. The JSX gate `{connection && <SessionControls ... />}`
 * evaluated once during initial render (when connection was undefined) and
 * never re-evaluated once connectRelay() resolved, permanently hiding SessionControls.
 *
 * This test verifies the fix: connection is now a signal, and the gate
 * re-evaluates correctly, so SessionControls mounts and becomes visible.
 */
describe("REQ-042 — SessionControls mounts once relay connects", () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("SessionControls becomes present in DOM after relay connection", async () => {
    try {
      // Create a room
      const room = await harness.createRoom();

      // Open a view as the host
      const hostView = await harness.openView();
      await hostView.navigate(
        `${harness.baseUrl}/room/${room.code}?clientToken=${room.hostClientToken}`,
      );

      // Wait for SessionControls to become present in the DOM.
      // The harness doesn't provide a direct wait helper, so we use a polling loop
      // with a bounded timeout (NFR-014: no arbitrary sleeps).
      const maxWaitMs = 5000;
      const pollIntervalMs = 100;
      const startTime = Date.now();
      let found = false;

      while (Date.now() - startTime < maxWaitMs) {
        const sessionControlsPresent = await hostView.evaluate(
          `(() => !!document.querySelector('${selectors.sessionControls}'))()`,
        );
        if (sessionControlsPresent) {
          found = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      // Assert that SessionControls was found before timeout
      expect(found).toBe(true);

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
});
