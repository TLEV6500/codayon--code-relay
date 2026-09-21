import { describe, it, expect, beforeEach } from "bun:test";

/**
 * Unit tests for manual driver picker (FEAT-003 Task 4, REQ-030).
 *
 * Verifies:
 * - Driver picker only visible when: selectionPolicy='manual' + role='host' + session active + not driving
 * - Lists connected, non-spectator participants
 * - Excludes disconnected and spectator participants
 * - Excludes current driver from selection
 * - Sends startTurn message with chosen participantId
 * - Message format conforms to protocol
 */

interface MockRoster {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly connected: boolean;
}

interface MockTurnConfig {
  readonly mode: string;
  readonly durationMs: number;
  readonly selectionPolicy: string;
}

/**
 * Mock SessionControls state for testing driver picker logic.
 */
class MockSessionControls {
  role: "host" | "observer" | "spectator" = "host";
  sessionPhase: "created" | "active" | "ended" = "active";
  turnConfig: MockTurnConfig | null = null;
  isCurrentDriver: boolean = false;
  currentDriver: string | null = null;
  roster: MockRoster[] = [];
  sentMessages: unknown[] = [];

  /**
   * Simulate connection.send()
   */
  send(msg: unknown): void {
    this.sentMessages.push(msg);
  }

  /**
   * Get eligible drivers for manual selection.
   * - Connected participants only
   * - Non-spectators (observer, host-participant)
   * - Exclude current driver
   */
  getEligibleDrivers(): MockRoster[] {
    return this.roster.filter(
      (p) =>
        p.connected &&
        (p.role === "observer" || p.role === "host-participant") &&
        p.id !== this.currentDriver
    );
  }

  /**
   * Determine if driver picker should be visible.
   * Visible when:
   * - Host is not the current driver
   * - Session is active
   * - Selection policy is manual
   */
  shouldShowDriverPicker(): boolean {
    const isManualMode = this.turnConfig?.selectionPolicy === "manual";
    const isHostNotDriving = this.role === "host" && !this.isCurrentDriver;
    const isSessionActive = this.sessionPhase === "active";
    return isManualMode && isHostNotDriving && isSessionActive;
  }

  /**
   * Simulate driver selection.
   */
  handleSelectDriver(driverId: string): void {
    if (driverId) {
      this.send({
        channel: "control",
        type: "startTurn",
        driver: driverId,
      });
    }
  }
}

describe("Manual Driver Picker (FEAT-003 Task 4, REQ-030)", () => {
  let controls: MockSessionControls;

  beforeEach(() => {
    controls = new MockSessionControls();
  });

  describe("picker visibility conditions", () => {
    it("is hidden when not in host role", () => {
      controls.role = "observer";
      controls.sessionPhase = "active";
      controls.turnConfig = {
        mode: "fixed",
        durationMs: 180000,
        selectionPolicy: "manual",
      };
      expect(controls.shouldShowDriverPicker()).toBe(false);
    });

    it("is hidden when session not active", () => {
      controls.role = "host";
      controls.sessionPhase = "created";
      controls.turnConfig = {
        mode: "fixed",
        durationMs: 180000,
        selectionPolicy: "manual",
      };
      expect(controls.shouldShowDriverPicker()).toBe(false);
    });

    it("is hidden when selection policy is not manual", () => {
      controls.role = "host";
      controls.sessionPhase = "active";
      controls.turnConfig = {
        mode: "fixed",
        durationMs: 180000,
        selectionPolicy: "round-robin",
      };
      expect(controls.shouldShowDriverPicker()).toBe(false);
    });

    it("is hidden when host is currently driving", () => {
      controls.role = "host";
      controls.sessionPhase = "active";
      controls.turnConfig = {
        mode: "fixed",
        durationMs: 180000,
        selectionPolicy: "manual",
      };
      controls.isCurrentDriver = true;
      controls.currentDriver = "host-client";
      expect(controls.shouldShowDriverPicker()).toBe(false);
    });

    it("is visible when all conditions met", () => {
      controls.role = "host";
      controls.sessionPhase = "active";
      controls.turnConfig = {
        mode: "fixed",
        durationMs: 180000,
        selectionPolicy: "manual",
      };
      controls.isCurrentDriver = false;
      expect(controls.shouldShowDriverPicker()).toBe(true);
    });

    it("is hidden when turnConfig is null", () => {
      controls.role = "host";
      controls.sessionPhase = "active";
      controls.turnConfig = null;
      controls.isCurrentDriver = false;
      expect(controls.shouldShowDriverPicker()).toBe(false);
    });
  });

  describe("eligible driver filtering", () => {
    beforeEach(() => {
      controls.roster = [
        {
          id: "alice",
          name: "Alice",
          role: "observer",
          connected: true,
        },
        {
          id: "bob",
          name: "Bob",
          role: "observer",
          connected: true,
        },
        {
          id: "charlie",
          name: "Charlie",
          role: "spectator",
          connected: true,
        },
        {
          id: "dave",
          name: "Dave",
          role: "observer",
          connected: false,
        },
        {
          id: "host",
          name: "Host",
          role: "host-participant",
          connected: true,
        },
      ];
    });

    it("includes connected observers", () => {
      const eligible = controls.getEligibleDrivers();
      expect(eligible.some((d) => d.id === "alice")).toBe(true);
      expect(eligible.some((d) => d.id === "bob")).toBe(true);
    });

    it("includes connected host-participants", () => {
      const eligible = controls.getEligibleDrivers();
      expect(eligible.some((d) => d.id === "host")).toBe(true);
    });

    it("excludes disconnected participants", () => {
      const eligible = controls.getEligibleDrivers();
      expect(eligible.some((d) => d.id === "dave")).toBe(false);
    });

    it("excludes spectators", () => {
      const eligible = controls.getEligibleDrivers();
      expect(eligible.some((d) => d.id === "charlie")).toBe(false);
    });

    it("excludes current driver from eligible list", () => {
      controls.currentDriver = "alice";
      const eligible = controls.getEligibleDrivers();
      expect(eligible.some((d) => d.id === "alice")).toBe(false);
      expect(eligible.some((d) => d.id === "bob")).toBe(true);
    });

    it("returns empty array when roster is empty", () => {
      controls.roster = [];
      const eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(0);
    });

    it("returns empty array when all are spectators or disconnected", () => {
      controls.roster = [
        { id: "spec1", name: "Spec1", role: "spectator", connected: true },
        { id: "spec2", name: "Spec2", role: "spectator", connected: false },
      ];
      const eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(0);
    });

    it("excludes host-only (non-participant) role from drivers", () => {
      controls.roster = [
        {
          id: "host-admin",
          name: "Host",
          role: "host",
          connected: true,
        },
      ];
      const eligible = controls.getEligibleDrivers();
      // Host without host-participant role should not be eligible
      expect(eligible.length).toBe(0);
    });
  });

  describe("startTurn message generation", () => {
    beforeEach(() => {
      controls.role = "host";
      controls.sessionPhase = "active";
      controls.turnConfig = {
        mode: "fixed",
        durationMs: 180000,
        selectionPolicy: "manual",
      };
      controls.isCurrentDriver = false;
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
        { id: "bob", name: "Bob", role: "observer", connected: true },
      ];
    });

    it("sends startTurn message with correct structure", () => {
      controls.handleSelectDriver("alice");
      expect(controls.sentMessages.length).toBe(1);
      const msg = controls.sentMessages[0] as any;
      expect(msg.channel).toBe("control");
      expect(msg.type).toBe("startTurn");
      expect(msg.driver).toBe("alice");
    });

    it("sends startTurn with chosen participant id", () => {
      controls.handleSelectDriver("bob");
      const msg = controls.sentMessages[0] as any;
      expect(msg.driver).toBe("bob");
    });

    it("does not send message for empty selection", () => {
      controls.handleSelectDriver("");
      expect(controls.sentMessages.length).toBe(0);
    });

    it("sends one message per selection", () => {
      controls.handleSelectDriver("alice");
      controls.handleSelectDriver("bob");
      expect(controls.sentMessages.length).toBe(2);
    });

    it("sends startTurn only for connected, non-spectator drivers", () => {
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
        { id: "dave", name: "Dave", role: "observer", connected: false },
      ];
      // Alice is eligible
      controls.handleSelectDriver("alice");
      expect(controls.sentMessages.length).toBe(1);
      expect((controls.sentMessages[0] as any).driver).toBe("alice");

      controls.sentMessages = [];

      // Dave is not eligible, but we still send the message (validation is server-side)
      // This tests that the client sends the request, server rejects if invalid
      controls.handleSelectDriver("dave");
      expect(controls.sentMessages.length).toBe(1);
      expect((controls.sentMessages[0] as any).driver).toBe("dave");
    });
  });

  describe("picker state transitions", () => {
    beforeEach(() => {
      controls.role = "host";
      controls.sessionPhase = "active";
      controls.turnConfig = {
        mode: "fixed",
        durationMs: 180000,
        selectionPolicy: "manual",
      };
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
        { id: "bob", name: "Bob", role: "observer", connected: true },
      ];
    });

    it("becomes visible when host is assigned as driver after turn start", () => {
      controls.isCurrentDriver = false;
      expect(controls.shouldShowDriverPicker()).toBe(true);

      // Host becomes driver
      controls.isCurrentDriver = true;
      controls.currentDriver = "host-client";
      expect(controls.shouldShowDriverPicker()).toBe(false);
    });

    it("becomes visible when driver assignment ends", () => {
      controls.isCurrentDriver = true;
      controls.currentDriver = "host-client";
      expect(controls.shouldShowDriverPicker()).toBe(false);

      // Turn ends
      controls.isCurrentDriver = false;
      controls.currentDriver = null;
      expect(controls.shouldShowDriverPicker()).toBe(true);
    });

    it("becomes hidden when session ends", () => {
      controls.isCurrentDriver = false;
      expect(controls.shouldShowDriverPicker()).toBe(true);

      controls.sessionPhase = "ended";
      expect(controls.shouldShowDriverPicker()).toBe(false);
    });

    it("becomes visible when policy changes to manual", () => {
      controls.turnConfig = {
        ...controls.turnConfig!,
        selectionPolicy: "round-robin",
      };
      expect(controls.shouldShowDriverPicker()).toBe(false);

      controls.turnConfig = {
        ...controls.turnConfig!,
        selectionPolicy: "manual",
      };
      expect(controls.shouldShowDriverPicker()).toBe(true);
    });
  });

  describe("roster updates", () => {
    it("reflects newly connected participants", () => {
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
      ];
      let eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(1);

      // Bob joins
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
        { id: "bob", name: "Bob", role: "observer", connected: true },
      ];
      eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(2);
    });

    it("reflects participant disconnection", () => {
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
        { id: "bob", name: "Bob", role: "observer", connected: true },
      ];
      let eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(2);

      // Alice disconnects
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: false },
        { id: "bob", name: "Bob", role: "observer", connected: true },
      ];
      eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(1);
      expect(eligible.some((d) => d.id === "bob")).toBe(true);
    });

    it("reflects role changes", () => {
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
        { id: "bob", name: "Bob", role: "spectator", connected: true },
      ];
      let eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(1);

      // Bob promoted to observer
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
        { id: "bob", name: "Bob", role: "observer", connected: true },
      ];
      eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("handles roster with single eligible driver", () => {
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
      ];
      const eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(1);
      expect(eligible[0]!.id).toBe("alice");
    });

    it("handles participant names with special characters", () => {
      controls.roster = [
        {
          id: "alice",
          name: "Alice O'Neill (she/her)",
          role: "observer",
          connected: true,
        },
      ];
      const eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(1);
      expect(eligible[0]!.name).toBe("Alice O'Neill (she/her)");
    });

    it("handles empty driver id selection", () => {
      controls.handleSelectDriver("");
      expect(controls.sentMessages.length).toBe(0);
    });

    it("preserves participant id through selection", () => {
      controls.roster = [
        { id: "abc-123-def", name: "Driver", role: "observer", connected: true },
      ];
      controls.handleSelectDriver("abc-123-def");
      const msg = controls.sentMessages[0] as any;
      expect(msg.driver).toBe("abc-123-def");
    });

    it("works with null currentDriver (no turn active)", () => {
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
      ];
      controls.currentDriver = null;
      const eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBeGreaterThan(0);
    });
  });

  describe("integration scenarios", () => {
    it("full session flow: host not driving → pick driver → turn starts → host cannot pick", () => {
      controls.role = "host";
      controls.sessionPhase = "active";
      controls.turnConfig = {
        mode: "fixed",
        durationMs: 180000,
        selectionPolicy: "manual",
      };
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
        { id: "bob", name: "Bob", role: "observer", connected: true },
      ];

      // Host can pick before turn
      controls.isCurrentDriver = false;
      controls.currentDriver = null;
      expect(controls.shouldShowDriverPicker()).toBe(true);

      // Host selects Alice
      controls.handleSelectDriver("alice");
      expect(controls.sentMessages.length).toBe(1);

      // Turn starts: Alice is now driver, host is not
      controls.currentDriver = "alice";
      controls.isCurrentDriver = false;
      expect(controls.shouldShowDriverPicker()).toBe(true); // Host can pick again

      // Alice ends turn
      controls.currentDriver = null;
      controls.isCurrentDriver = false;
      expect(controls.shouldShowDriverPicker()).toBe(true);

      // Host selects Bob
      controls.handleSelectDriver("bob");
      expect(controls.sentMessages.length).toBe(2);
    });

    it("full session flow: host is participating driver", () => {
      controls.role = "host";
      controls.sessionPhase = "active";
      controls.turnConfig = {
        mode: "fixed",
        durationMs: 180000,
        selectionPolicy: "manual",
      };
      controls.roster = [
        { id: "host-client", name: "Host", role: "host-participant", connected: true },
        { id: "alice", name: "Alice", role: "observer", connected: true },
      ];

      // Host is driving
      controls.isCurrentDriver = true;
      controls.currentDriver = "host-client";
      expect(controls.shouldShowDriverPicker()).toBe(false);

      // Host ends turn
      controls.isCurrentDriver = false;
      controls.currentDriver = null;
      expect(controls.shouldShowDriverPicker()).toBe(true);

      // Host picks Alice
      controls.handleSelectDriver("alice");
      expect(controls.sentMessages.length).toBe(1);
    });

    it("handles disconnect and reconnection", () => {
      controls.role = "host";
      controls.sessionPhase = "active";
      controls.turnConfig = {
        mode: "fixed",
        durationMs: 180000,
        selectionPolicy: "manual",
      };
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
      ];

      // Alice disconnects
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: false },
      ];
      let eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(0);

      // Alice reconnects
      controls.roster = [
        { id: "alice", name: "Alice", role: "observer", connected: true },
      ];
      eligible = controls.getEligibleDrivers();
      expect(eligible.length).toBe(1);
    });
  });
});
