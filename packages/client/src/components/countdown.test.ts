import { describe, expect, test } from "bun:test";

/**
 * Test countdown formatting logic.
 * REQ-027: Client turn countdown display
 */

// Helper function to format milliseconds to MM:SS (matches SessionControls implementation)
function formatCountdown(ms: number | null): string {
  if (ms === null || ms === undefined) return "--:--";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

describe("countdown formatting (REQ-027)", () => {
  test("formats null as neutral display", () => {
    expect(formatCountdown(null)).toBe("--:--");
  });

  test("formats undefined as neutral display", () => {
    expect(formatCountdown(undefined as any)).toBe("--:--");
  });

  test("formats milliseconds to MM:SS", () => {
    expect(formatCountdown(60000)).toBe("1:00");
    expect(formatCountdown(90000)).toBe("1:30");
    expect(formatCountdown(5000)).toBe("0:05");
    expect(formatCountdown(1000)).toBe("0:01");
  });

  test("rounds up to next second", () => {
    expect(formatCountdown(5001)).toBe("0:06");
    expect(formatCountdown(5999)).toBe("0:06");
  });

  test("handles 15-second duration (example from requirements)", () => {
    expect(formatCountdown(15000)).toBe("0:15");
  });

  test("handles 3-minute duration", () => {
    expect(formatCountdown(180000)).toBe("3:00");
  });

  test("handles zero", () => {
    expect(formatCountdown(0)).toBe("0:00");
  });

  test("pads seconds with leading zero", () => {
    expect(formatCountdown(65000)).toBe("1:05");
    expect(formatCountdown(3500)).toBe("0:04");
  });
});
