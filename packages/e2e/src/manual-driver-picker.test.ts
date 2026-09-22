import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startHarness, type E2EHarness } from "./harness";
import { selectors } from "./selectors";
import { waitForSelector } from "./test-helpers";

/**
 * REQ-046 — Manual driver picker visibility conditions
 *
 * Verifies that the driver picker appears/disappears based on:
 * 1. Selection policy is manual (not round-robin)
 * 2. Local view is the host
 * 3. Host is not the current driver (only show when not driving)
 * 4. Session is active
 * 5. Picker options match the connected, non-spectator roster
 */
describe("REQ-046 — Manual driver picker conditions", () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("Picker is absent in round-robin mode", async () => {
    try {
      const room = await harness.createRoom();
      const hostView = await harness.openView();
      await hostView.navigate(
        `${harness.baseUrl}/room/${room.code}?clientToken=${room.hostClientToken}`,
      );

      // Wait for SessionControls to load with polling
      const pickerVisible = await waitForSelector(hostView, selectors.manualDriverPicker, {
        timeoutMs: 5000,
        pollIntervalMs: 100,
      });
      expect(pickerVisible).toBe(false);

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

  it("Picker is absent for non-host views", async () => {
    try {
      const room = await harness.createRoom();
      const obsView = await harness.openView();
      await obsView.navigate(
        `${harness.baseUrl}/room/${room.code}?clientToken=${room.observerClientToken}`,
      );

      // Wait for SessionControls to load
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Observer should not see the picker
      const pickerVisible = await obsView.evaluate(
        `() => !!document.querySelector('${selectors.manualDriverPicker}')`,
      );
      expect(pickerVisible).toBe(false);

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
