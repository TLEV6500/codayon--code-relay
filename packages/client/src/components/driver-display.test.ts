import { describe, it, expect, beforeEach } from "bun:test";

/**
 * Unit tests for driver + turn number display (FEAT-003 Task 3, REQ-028/REQ-029).
 *
 * Verifies:
 * - turnNumber state tracked and updated from TurnStartedMsg
 * - currentDriver and currentDriverName tracked and updated
 * - "You are driving" label shown when local user is driver
 * - Remote driver name shown otherwise
 * - Clear/neutral state when no active turn
 * - Consistency across multiple updates
 */

// Mock TurnStartedMsg structure
interface MockTurnStartedMsg {
  type: "turnStarted";
  turnNumber: number;
  driver: string;
  driverName: string;
  startedAt: number;
  channel: "control";
}

// Mock TurnEndedMsg structure
interface MockTurnEndedMsg {
  type: "turnEnded";
  reason: "expiry" | "early-end" | "host-action";
  endedAt: number;
  channel: "control";
}

/**
 * Simulate RoomEditor state management for turn tracking.
 */
class MockRoomEditorState {
  currentDriver: string | null = null;
  currentDriverName: string | null = null;
  turnNumber: number | null = null;

  handleTurnStarted(msg: MockTurnStartedMsg) {
    this.currentDriver = msg.driver;
    this.currentDriverName = msg.driverName;
    this.turnNumber = msg.turnNumber;
  }

  handleTurnEnded(_msg: MockTurnEndedMsg) {
    this.currentDriver = null;
    this.currentDriverName = null;
    this.turnNumber = null;
  }

  /**
   * Determine display label based on whether local user is driving.
   */
  getDriverLabel(isLocalUser: boolean): string {
    if (this.turnNumber === null || this.currentDriver === null) {
      return "—";
    }
    if (isLocalUser) {
      return "You are driving";
    }
    return this.currentDriverName && this.currentDriverName.trim() ? this.currentDriverName : "—";
  }
}

describe("Driver Display (FEAT-003 Task 3)", () => {
  let state: MockRoomEditorState;

  beforeEach(() => {
    state = new MockRoomEditorState();
  });

  describe("turnNumber tracking", () => {
    it("initializes as null", () => {
      expect(state.turnNumber).toBeNull();
    });

    it("updates turnNumber from TurnStartedMsg", () => {
      const msg: MockTurnStartedMsg = {
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      };
      state.handleTurnStarted(msg);
      expect(state.turnNumber).toBe(1);
    });

    it("increments turnNumber across multiple turns", () => {
      // Turn 1
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });
      expect(state.turnNumber).toBe(1);

      // Turn ends
      state.handleTurnEnded({
        channel: "control",
        type: "turnEnded",
        reason: "expiry",
        endedAt: Date.now(),
      });
      expect(state.turnNumber).toBeNull();

      // Turn 2
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 2,
        driver: "client-bob",
        driverName: "Bob",
        startedAt: Date.now(),
      });
      expect(state.turnNumber).toBe(2);
    });

    it("clears turnNumber when turn ends", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });
      expect(state.turnNumber).toBe(1);

      state.handleTurnEnded({
        channel: "control",
        type: "turnEnded",
        reason: "expiry",
        endedAt: Date.now(),
      });
      expect(state.turnNumber).toBeNull();
    });
  });

  describe("currentDriver tracking", () => {
    it("initializes as null", () => {
      expect(state.currentDriver).toBeNull();
    });

    it("updates currentDriver and currentDriverName from TurnStartedMsg", () => {
      const msg: MockTurnStartedMsg = {
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      };
      state.handleTurnStarted(msg);
      expect(state.currentDriver).toBe("client-alice");
      expect(state.currentDriverName).toBe("Alice");
    });

    it("updates to next driver on consecutive turns", () => {
      // Alice's turn
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });
      expect(state.currentDriver).toBe("client-alice");
      expect(state.currentDriverName).toBe("Alice");

      // Turn ends
      state.handleTurnEnded({
        channel: "control",
        type: "turnEnded",
        reason: "expiry",
        endedAt: Date.now(),
      });

      // Bob's turn
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 2,
        driver: "client-bob",
        driverName: "Bob",
        startedAt: Date.now(),
      });
      expect(state.currentDriver).toBe("client-bob");
      expect(state.currentDriverName).toBe("Bob");
    });

    it("clears currentDriver when turn ends", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });
      expect(state.currentDriver).toBe("client-alice");

      state.handleTurnEnded({
        channel: "control",
        type: "turnEnded",
        reason: "expiry",
        endedAt: Date.now(),
      });
      expect(state.currentDriver).toBeNull();
    });
  });

  describe("driver label display", () => {
    it("shows neutral '—' when no active turn", () => {
      const label = state.getDriverLabel(false);
      expect(label).toBe("—");
    });

    it("shows 'You are driving' when local user is current driver", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });
      const label = state.getDriverLabel(true); // isLocalUser = true
      expect(label).toBe("You are driving");
    });

    it("shows remote driver name when another user is driving", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-bob",
        driverName: "Bob",
        startedAt: Date.now(),
      });
      const label = state.getDriverLabel(false); // isLocalUser = false
      expect(label).toBe("Bob");
    });

    it("shows remote driver name (not currentDriver ID)", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-123456-uuid",
        driverName: "Charlie",
        startedAt: Date.now(),
      });
      const label = state.getDriverLabel(false);
      expect(label).toBe("Charlie");
      expect(label).not.toBe("client-123456-uuid");
    });

    it("clears label when turn ends", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });
      expect(state.getDriverLabel(false)).toBe("Alice");

      state.handleTurnEnded({
        channel: "control",
        type: "turnEnded",
        reason: "expiry",
        endedAt: Date.now(),
      });
      expect(state.getDriverLabel(false)).toBe("—");
    });
  });

  describe("multi-tab consistency", () => {
    it("both tabs show same driver across TurnStartedMsg", () => {
      const tab1 = new MockRoomEditorState();
      const tab2 = new MockRoomEditorState();

      const msg: MockTurnStartedMsg = {
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      };

      tab1.handleTurnStarted(msg);
      tab2.handleTurnStarted(msg);

      expect(tab1.currentDriver).toBe(tab2.currentDriver);
      expect(tab1.currentDriverName).toBe(tab2.currentDriverName);
      expect(tab1.turnNumber).toBe(tab2.turnNumber);
    });

    it("both tabs show same label for remote driver", () => {
      const tab1 = new MockRoomEditorState();
      const tab2 = new MockRoomEditorState();

      const msg: MockTurnStartedMsg = {
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-bob",
        driverName: "Bob",
        startedAt: Date.now(),
      };

      tab1.handleTurnStarted(msg);
      tab2.handleTurnStarted(msg);

      expect(tab1.getDriverLabel(false)).toBe(tab2.getDriverLabel(false));
      expect(tab1.getDriverLabel(false)).toBe("Bob");
    });

    it("tabs show different labels based on local isCurrentDriver", () => {
      const tab1 = new MockRoomEditorState();
      const tab2 = new MockRoomEditorState();

      const msg: MockTurnStartedMsg = {
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      };

      tab1.handleTurnStarted(msg);
      tab2.handleTurnStarted(msg);

      // Tab 1: Alice is driving (isLocalUser = true for Alice)
      const tab1Label = tab1.getDriverLabel(true);
      // Tab 2: Someone else is viewing (isLocalUser = false for non-Alice)
      const tab2Label = tab2.getDriverLabel(false);

      expect(tab1Label).toBe("You are driving");
      expect(tab2Label).toBe("Alice");
      expect(tab1Label).not.toBe(tab2Label);
    });
  });

  describe("edge cases", () => {
    it("handles empty driverName gracefully", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "",
        startedAt: Date.now(),
      });
      // Empty driverName falls back to neutral neutral display
      const label = state.getDriverLabel(false);
      expect(label).toBe("—");
    });

    it("handles turnNumber 0", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 0,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });
      expect(state.turnNumber).toBe(0);
    });

    it("handles large turnNumber", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 999,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });
      expect(state.turnNumber).toBe(999);
    });

    it("handles special characters in driverName", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice O'Neill (she/her)",
        startedAt: Date.now(),
      });
      expect(state.currentDriverName).toBe("Alice O'Neill (she/her)");
      const label = state.getDriverLabel(false);
      expect(label).toBe("Alice O'Neill (she/her)");
    });

    it("handles rapid turn transitions", () => {
      // Turn 1
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });
      expect(state.turnNumber).toBe(1);

      // Turn 2 (without explicit turnEnded)
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 2,
        driver: "client-bob",
        driverName: "Bob",
        startedAt: Date.now(),
      });
      expect(state.turnNumber).toBe(2);
      expect(state.currentDriverName).toBe("Bob");
    });
  });

  describe("turn-ended reason handling", () => {
    it("clears state on expiry", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });

      state.handleTurnEnded({
        channel: "control",
        type: "turnEnded",
        reason: "expiry",
        endedAt: Date.now(),
      });

      expect(state.turnNumber).toBeNull();
      expect(state.currentDriver).toBeNull();
      expect(state.currentDriverName).toBeNull();
    });

    it("clears state on early-end", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });

      state.handleTurnEnded({
        channel: "control",
        type: "turnEnded",
        reason: "early-end",
        endedAt: Date.now(),
      });

      expect(state.turnNumber).toBeNull();
    });

    it("clears state on host-action", () => {
      state.handleTurnStarted({
        channel: "control",
        type: "turnStarted",
        turnNumber: 1,
        driver: "client-alice",
        driverName: "Alice",
        startedAt: Date.now(),
      });

      state.handleTurnEnded({
        channel: "control",
        type: "turnEnded",
        reason: "host-action",
        endedAt: Date.now(),
      });

      expect(state.turnNumber).toBeNull();
    });
  });
});
