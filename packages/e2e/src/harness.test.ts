import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startHarness, type E2EHarness } from "./harness";

describe("E2E Harness", () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("boots server + client on ephemeral ports", () => {
    expect(harness.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("opens a WebView and navigates to the client", async () => {
    try {
      const view = await harness.openView();
      await view.navigate(harness.baseUrl);

      // Assert the page title is set (basic sanity check that the client loaded).
      const title = await view.evaluate("() => document.title");
      expect(title).toBeTruthy();

      view.close();
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

  it("creates a room and returns tokens", async () => {
    const room = await harness.createRoom();
    expect(room.code).toBeTruthy();
    expect(room.hostToken).toBeTruthy();
    expect(room.hostClientToken).toBeTruthy();
    expect(room.observerClientToken).toBeTruthy();
  });
});
