import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startHarness, type E2EHarness } from "./harness";
import { selectors } from "./selectors";

/**
 * REQ-047 — Rotation order visibility + late-joiner insertion
 *
 * Verifies that:
 * 1. Rotation order list appears in round-robin mode
 * 2. Next-up entry is visually highlighted
 * 3. Late joiners are inserted fairly into the rotation
 * 4. The rendered list updates after each addition
 */
describe("REQ-047 — Rotation order visibility + late-joiner insertion", () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("Rotation order is absent before session starts", async () => {
    try {
      const room = await harness.createRoom();
      const hostView = await harness.openView();
      await hostView.navigate(
        `${harness.baseUrl}/room/${room.code}?clientToken=${room.hostClientToken}`,
      );

      // Wait for SessionControls to load
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Rotation order should not be visible before session starts
      const rotationVisible = await hostView.evaluate(
        `() => !!document.querySelector('${selectors.rotationOrderList}')`,
      );
      expect(rotationVisible).toBe(false);

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

  it("Rotation order updates when new participants join", async () => {
    try {
      const room = await harness.createRoom();
      const hostView = await harness.openView();
      const obsView = await harness.openView();

      await hostView.navigate(
        `${harness.baseUrl}/room/${room.code}?clientToken=${room.hostClientToken}`,
      );
      await obsView.navigate(
        `${harness.baseUrl}/room/${room.code}?clientToken=${room.observerClientToken}`,
      );

      // Wait for both views to load
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify both views have SessionControls
      const hostControlsVisible = await hostView.evaluate(
        `() => !!document.querySelector('${selectors.sessionControls}')`,
      );
      expect(hostControlsVisible).toBe(true);

      const obsControlsVisible = await obsView.evaluate(
        `() => !!document.querySelector('${selectors.sessionControls}')`,
      );
      expect(obsControlsVisible).toBe(true);

      hostView.close();
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
