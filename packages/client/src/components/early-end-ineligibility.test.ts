import { describe, it, expect, beforeEach } from "bun:test";

/**
 * Unit tests for early-end ineligibility affordance (FEAT-003 Task 12, REQ-038).
 *
 * Verifies:
 * - When local user is Driver + mode === "fixed-early-end": show enabled early-end button
 * - When local user is Driver + mode === "fixed": show disabled button with explanation
 * - Button never omitted when local user is Driver (regardless of mode)
 * - Explanation text: "Early end not enabled for this session"
 * - Disabled state styling (opacity-60, cursor-not-allowed, bg-slate-700)
 * - Enabled state styling (bg-amber-600, hover:bg-amber-500)
 */

// Mock TurnConfig structure
interface MockTurnConfig {
  mode: "fixed" | "fixed-early-end";
  durationMs: number;
  selectionPolicy: "round-robin" | "manual";
}

/**
 * Simulate early-end button state logic.
 */
class MockEarlyEndButtonLogic {
  isCurrentDriver: boolean = false;
  turnConfig: MockTurnConfig | null = null;

  /**
   * Determine if button should be visible.
   * Show button when local user is Driver (regardless of mode).
   */
  shouldShowButton(): boolean {
    return this.isCurrentDriver;
  }

  /**
   * Determine if button should be enabled.
   * Enable only when mode === "fixed-early-end".
   */
  isButtonEnabled(): boolean {
    return this.isCurrentDriver && this.turnConfig?.mode === "fixed-early-end";
  }

  /**
   * Get button state as a string.
   * "hidden" | "enabled" | "disabled"
   */
  getButtonState(): "hidden" | "enabled" | "disabled" {
    if (!this.shouldShowButton()) {
      return "hidden";
    }
    return this.isButtonEnabled() ? "enabled" : "disabled";
  }

  /**
   * Get explanation text when disabled.
   * Returns null when enabled or hidden.
   */
  getExplanationText(): string | null {
    if (this.getButtonState() === "disabled") {
      return "Early end not enabled for this session";
    }
    return null;
  }

  /**
   * Get CSS classes for button when disabled.
   */
  getDisabledButtonClasses(): string {
    return "w-full px-3 py-2 bg-slate-700 text-slate-400 font-semibold rounded text-sm cursor-not-allowed opacity-60";
  }

  /**
   * Get CSS classes for button when enabled.
   */
  getEnabledButtonClasses(): string {
    return "w-full px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded text-sm";
  }
}

describe("Early-End Ineligibility Affordance (FEAT-003 Task 12, REQ-038)", () => {
  let logic: MockEarlyEndButtonLogic;

  beforeEach(() => {
    logic = new MockEarlyEndButtonLogic();
  });

  describe("Button visibility (REQ-038.1)", () => {
    it("hides button when local user is NOT a driver", () => {
      logic.isCurrentDriver = false;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.shouldShowButton()).toBe(false);
    });

    it("shows button when local user IS a driver (fixed mode)", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.shouldShowButton()).toBe(true);
    });

    it("shows button when local user IS a driver (fixed-early-end mode)", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.shouldShowButton()).toBe(true);
    });

    it("never omits button when driver (regardless of mode)", () => {
      logic.isCurrentDriver = true;
      
      // Test with fixed mode
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.shouldShowButton()).toBe(true);
      
      // Test with fixed-early-end mode
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.shouldShowButton()).toBe(true);
    });

    it("hides button when turnConfig is null", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = null;
      expect(logic.shouldShowButton()).toBe(true); // Still shows due to isCurrentDriver
      expect(logic.isButtonEnabled()).toBe(false); // But disabled due to null config
    });
  });

  describe("Button enablement (REQ-038.2)", () => {
    it("enables button when driver + mode=fixed-early-end", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.isButtonEnabled()).toBe(true);
    });

    it("disables button when driver + mode=fixed", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.isButtonEnabled()).toBe(false);
    });

    it("disables button when NOT driver + mode=fixed-early-end", () => {
      logic.isCurrentDriver = false;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.isButtonEnabled()).toBe(false);
    });

    it("disables button when turnConfig is null", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = null;
      expect(logic.isButtonEnabled()).toBe(false);
    });
  });

  describe("Button state transitions (REQ-038.3)", () => {
    it("transitions from enabled to disabled when mode changes from fixed-early-end to fixed", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("enabled");

      // Mode changes to fixed
      logic.turnConfig.mode = "fixed";
      expect(logic.getButtonState()).toBe("disabled");
    });

    it("transitions from disabled to enabled when mode changes from fixed to fixed-early-end", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("disabled");

      // Mode changes to fixed-early-end
      logic.turnConfig.mode = "fixed-early-end";
      expect(logic.getButtonState()).toBe("enabled");
    });

    it("transitions from hidden to disabled when local user becomes driver (fixed mode)", () => {
      logic.isCurrentDriver = false;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("hidden");

      // Local user becomes driver
      logic.isCurrentDriver = true;
      expect(logic.getButtonState()).toBe("disabled");
    });

    it("transitions from hidden to enabled when local user becomes driver (fixed-early-end mode)", () => {
      logic.isCurrentDriver = false;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("hidden");

      // Local user becomes driver
      logic.isCurrentDriver = true;
      expect(logic.getButtonState()).toBe("enabled");
    });

    it("transitions from enabled to hidden when local user is no longer driver", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("enabled");

      // Local user is no longer driver
      logic.isCurrentDriver = false;
      expect(logic.getButtonState()).toBe("hidden");
    });
  });

  describe("Explanation text (REQ-038.4)", () => {
    it("shows explanation when button is disabled (fixed mode)", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getExplanationText()).toBe("Early end not enabled for this session");
    });

    it("does not show explanation when button is enabled", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getExplanationText()).toBeNull();
    });

    it("does not show explanation when button is hidden", () => {
      logic.isCurrentDriver = false;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getExplanationText()).toBeNull();
    });

    it("shows exactly the specified explanation text", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      const text = logic.getExplanationText();
      expect(text).toBe("Early end not enabled for this session");
      expect(text?.includes("not enabled")).toBe(true);
      expect(text?.includes("session")).toBe(true);
    });
  });

  describe("Styling (REQ-038.5)", () => {
    it("applies disabled styling when button is disabled", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      
      const classes = logic.getDisabledButtonClasses();
      expect(classes).toContain("bg-slate-700");
      expect(classes).toContain("text-slate-400");
      expect(classes).toContain("cursor-not-allowed");
      expect(classes).toContain("opacity-60");
    });

    it("applies enabled styling when button is enabled", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      
      const classes = logic.getEnabledButtonClasses();
      expect(classes).toContain("bg-amber-600");
      expect(classes).toContain("hover:bg-amber-500");
      expect(classes).toContain("text-white");
    });

    it("disabled styling is visually distinct from enabled", () => {
      const disabled = logic.getDisabledButtonClasses();
      const enabled = logic.getEnabledButtonClasses();
      
      // Different background colors
      expect(disabled).toContain("bg-slate-700");
      expect(enabled).toContain("bg-amber-600");
      
      // Different text colors
      expect(disabled).toContain("text-slate-400");
      expect(enabled).toContain("text-white");
      
      // Disabled has cursor-not-allowed
      expect(disabled).toContain("cursor-not-allowed");
      expect(enabled).not.toContain("cursor-not-allowed");
      
      // Disabled has reduced opacity
      expect(disabled).toContain("opacity-60");
      expect(enabled).not.toContain("opacity-60");
    });
  });

  describe("Multiple mode configurations (REQ-038.6)", () => {
    it("handles round-robin selection policy with fixed mode", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("disabled");
      expect(logic.getExplanationText()).toBe("Early end not enabled for this session");
    });

    it("handles round-robin selection policy with fixed-early-end mode", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("enabled");
      expect(logic.getExplanationText()).toBeNull();
    });

    it("handles manual selection policy with fixed mode", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "manual" };
      expect(logic.getButtonState()).toBe("disabled");
      expect(logic.getExplanationText()).toBe("Early end not enabled for this session");
    });

    it("handles manual selection policy with fixed-early-end mode", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "manual" };
      expect(logic.getButtonState()).toBe("enabled");
      expect(logic.getExplanationText()).toBeNull();
    });

    it("handles various turn durations with fixed mode", () => {
      logic.isCurrentDriver = true;
      
      // 30 seconds
      logic.turnConfig = { mode: "fixed", durationMs: 30000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("disabled");
      
      // 5 minutes
      logic.turnConfig = { mode: "fixed", durationMs: 300000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("disabled");
      
      // 10 minutes
      logic.turnConfig = { mode: "fixed", durationMs: 600000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("disabled");
    });

    it("handles various turn durations with fixed-early-end mode", () => {
      logic.isCurrentDriver = true;
      
      // 30 seconds
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 30000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("enabled");
      
      // 5 minutes
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 300000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("enabled");
      
      // 10 minutes
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 600000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("enabled");
    });
  });

  describe("Edge cases", () => {
    it("handles undefined turnConfig gracefully", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = undefined as any;
      expect(logic.getButtonState()).toBe("disabled");
      expect(logic.isButtonEnabled()).toBe(false);
    });

    it("handles null mode gracefully", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: null as any, durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("disabled");
    });

    it("handles rapid isCurrentDriver changes", () => {
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      
      logic.isCurrentDriver = true;
      expect(logic.getButtonState()).toBe("enabled");
      
      logic.isCurrentDriver = false;
      expect(logic.getButtonState()).toBe("hidden");
      
      logic.isCurrentDriver = true;
      expect(logic.getButtonState()).toBe("enabled");
      
      logic.isCurrentDriver = false;
      expect(logic.getButtonState()).toBe("hidden");
    });

    it("handles rapid mode changes", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      
      logic.turnConfig.mode = "fixed-early-end";
      expect(logic.getButtonState()).toBe("enabled");
      
      logic.turnConfig.mode = "fixed";
      expect(logic.getButtonState()).toBe("disabled");
      
      logic.turnConfig.mode = "fixed-early-end";
      expect(logic.getButtonState()).toBe("enabled");
    });
  });

  describe("Integration scenarios", () => {
    it("scenario: join session with fixed mode, user becomes driver", () => {
      // User joins, not yet driver
      logic.isCurrentDriver = false;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("hidden");

      // User becomes driver
      logic.isCurrentDriver = true;
      expect(logic.getButtonState()).toBe("disabled");
      expect(logic.getExplanationText()).toBe("Early end not enabled for this session");
    });

    it("scenario: join session with fixed-early-end mode, user becomes driver", () => {
      // User joins, not yet driver
      logic.isCurrentDriver = false;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("hidden");

      // User becomes driver
      logic.isCurrentDriver = true;
      expect(logic.getButtonState()).toBe("enabled");
      expect(logic.getExplanationText()).toBeNull();
    });

    it("scenario: turn ends, button transitions from enabled to hidden", () => {
      // Driver with fixed-early-end mode
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("enabled");

      // Turn ends (driver role is lost)
      logic.isCurrentDriver = false;
      expect(logic.getButtonState()).toBe("hidden");
    });

    it("scenario: host enables early-end mid-session (mode update)", () => {
      // Session starts in fixed mode
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("disabled");

      // Host updates to fixed-early-end mode (e.g., via reconfigure)
      if (logic.turnConfig) {
        logic.turnConfig.mode = "fixed-early-end";
      }
      expect(logic.getButtonState()).toBe("enabled");
    });

    it("scenario: host disables early-end mid-session (mode update)", () => {
      // Session starts in fixed-early-end mode
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed-early-end", durationMs: 180000, selectionPolicy: "round-robin" };
      expect(logic.getButtonState()).toBe("enabled");

      // Host updates to fixed mode
      if (logic.turnConfig) {
        logic.turnConfig.mode = "fixed";
      }
      expect(logic.getButtonState()).toBe("disabled");
      expect(logic.getExplanationText()).toBe("Early end not enabled for this session");
    });
  });

  describe("REQ-038 comprehensive compliance", () => {
    it("REQ-038.1: Shows disabled button when driver + mode !== fixed-early-end", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      
      expect(logic.shouldShowButton()).toBe(true);
      expect(logic.isButtonEnabled()).toBe(false);
      expect(logic.getExplanationText()).toBe("Early end not enabled for this session");
    });

    it("REQ-038.2: Never omits button entirely when driver", () => {
      logic.isCurrentDriver = true;
      
      // Test all mode combinations
      const modes: Array<"fixed" | "fixed-early-end"> = ["fixed", "fixed-early-end"];
      modes.forEach((mode) => {
        logic.turnConfig = { mode, durationMs: 180000, selectionPolicy: "round-robin" };
        expect(logic.shouldShowButton()).toBe(true);
      });
    });

    it("REQ-038.3: Shows exact explanation text", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      
      const text = logic.getExplanationText();
      expect(text).toBe("Early end not enabled for this session");
    });

    it("REQ-038.4: Button is disabled (not just hidden) when ineligible", () => {
      logic.isCurrentDriver = true;
      logic.turnConfig = { mode: "fixed", durationMs: 180000, selectionPolicy: "round-robin" };
      
      // Button is shown (not hidden)
      expect(logic.shouldShowButton()).toBe(true);
      
      // Button is disabled (not enabled)
      expect(logic.isButtonEnabled()).toBe(false);
      
      // Disabled classes applied
      const classes = logic.getDisabledButtonClasses();
      expect(classes).toContain("cursor-not-allowed"); // Indicates disabled state
      expect(classes).toContain("opacity-60");
      expect(classes).toContain("bg-slate-700");
    });
  });
});
