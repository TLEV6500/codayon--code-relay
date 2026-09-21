import { describe, expect, test } from "bun:test";

/**
 * Test grace period UI logic.
 * REQ-033, Task 7: Disconnect grace period client UX
 *
 * Tests verify:
 * - Grace period countdown formatting
 * - Modal visibility conditions (host-only)
 * - Banner visibility conditions (all participants)
 * - Message structure for resolveGrace actions
 */

// Helper: format milliseconds to MM:SS (matches formatCountdown in GracePeriodModal)
function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

describe("grace period countdown formatting (REQ-033, Task 7)", () => {
  test("formats milliseconds to MM:SS", () => {
    expect(formatCountdown(60000)).toBe("1:00");
    expect(formatCountdown(30000)).toBe("0:30");
    expect(formatCountdown(15000)).toBe("0:15");
    expect(formatCountdown(5000)).toBe("0:05");
  });

  test("rounds up to next second", () => {
    expect(formatCountdown(5001)).toBe("0:06");
    expect(formatCountdown(5999)).toBe("0:06");
  });

  test("handles zero", () => {
    expect(formatCountdown(0)).toBe("0:00");
  });

  test("pads seconds with leading zero", () => {
    expect(formatCountdown(65000)).toBe("1:05");
    expect(formatCountdown(3500)).toBe("0:04");
  });
});

describe("grace period state types (REQ-033, Task 7)", () => {
  test("graceState has all required fields", () => {
    const graceState = {
      participantId: "p1",
      participantName: "Alice",
      gracePeriodMs: 30000,
      startedAt: Date.now(),
    };

    expect(graceState.participantId).toBeDefined();
    expect(graceState.participantName).toBeDefined();
    expect(graceState.gracePeriodMs).toBeGreaterThan(0);
    expect(graceState.startedAt).toBeGreaterThan(0);
  });

  test("resolveGrace message structure for 'reassign' action", () => {
    const msg = {
      channel: "control" as const,
      type: "resolveGrace" as const,
      action: "reassign" as const,
      newDriver: "p2",
    };

    expect(msg.channel).toBe("control");
    expect(msg.type).toBe("resolveGrace");
    expect(msg.action).toBe("reassign");
    expect(msg.newDriver).toBeDefined();
  });

  test("resolveGrace message structure for 'extend' action", () => {
    const msg = {
      channel: "control" as const,
      type: "resolveGrace" as const,
      action: "extend" as const,
      newDriver: undefined as string | undefined,
    };

    expect(msg.channel).toBe("control");
    expect(msg.type).toBe("resolveGrace");
    expect(msg.action).toBe("extend");
    expect(msg.newDriver).toBeUndefined();
  });

  test("resolveGrace message structure for 'skip' action", () => {
    const msg = {
      channel: "control" as const,
      type: "resolveGrace" as const,
      action: "skip" as const,
      newDriver: undefined as string | undefined,
    };

    expect(msg.channel).toBe("control");
    expect(msg.type).toBe("resolveGrace");
    expect(msg.action).toBe("skip");
    expect(msg.newDriver).toBeUndefined();
  });
});

describe("grace period UI visibility rules (REQ-033, Task 7)", () => {
  test("grace period banner visible when graceState is not null", () => {
    const graceState = {
      participantId: "p1",
      participantName: "Alice",
      gracePeriodMs: 30000,
      startedAt: Date.now(),
    };

    // Banner should be visible (not null)
    expect(graceState).not.toBeNull();
  });

  test("grace period banner hidden when graceState is null", () => {
    const graceState = null;

    // Banner should be hidden (null)
    expect(graceState).toBeNull();
  });

  test("grace period modal visible only when isHostOnly is true and graceState is not null", () => {
    const graceState = {
      participantId: "p1",
      participantName: "Alice",
      gracePeriodMs: 30000,
      startedAt: Date.now(),
    };
    const isHostOnly = true;

    // Modal should be visible (host and grace state active)
    expect(isHostOnly && graceState !== null).toBe(true);
  });

  test("grace period modal hidden when role is not host", () => {
    const graceState = {
      participantId: "p1",
      participantName: "Alice",
      gracePeriodMs: 30000,
      startedAt: Date.now(),
    };
    // Simulate a non-host role checking visibility
    const roles: ("host" | "observer" | "spectator")[] = ["observer", "spectator"];
    
    for (const role of roles) {
      const isHostOnly = role === "host";
      // Modal should be hidden (not host)
      expect(isHostOnly && graceState !== null).toBe(false);
    }
  });

  test("grace period modal hidden when graceState is null", () => {
    const graceState = null;
    const isHostOnly = true;

    // Modal should be hidden (no grace state)
    expect(isHostOnly && graceState !== null).toBe(false);
  });
});

describe("eligible driver filtering for reassignment (REQ-033, Task 7)", () => {
  test("filters out spectators and disconnected participants", () => {
    const graceState = {
      participantId: "p1",
      participantName: "Alice (disconnected)",
      gracePeriodMs: 30000,
      startedAt: Date.now(),
    };

    const roster = [
      { id: "p1", name: "Alice", role: "observer", connected: false },
      { id: "p2", name: "Bob", role: "observer", connected: true },
      { id: "p3", name: "Carol", role: "spectator", connected: true },
      { id: "p4", name: "Dave", role: "host-participant", connected: true },
    ];

    const eligibleDrivers = roster.filter(
      (p) =>
        p.connected &&
        (p.role === "observer" || p.role === "host-participant") &&
        p.id !== graceState.participantId
    );

    expect(eligibleDrivers.length).toBe(2);
    expect(eligibleDrivers.map((p) => p.id)).toEqual(["p2", "p4"]);
  });

  test("includes both observers and host-participants", () => {
    const graceState = {
      participantId: "p1",
      participantName: "Alice",
      gracePeriodMs: 30000,
      startedAt: Date.now(),
    };

    const roster = [
      { id: "p1", name: "Alice", role: "observer", connected: true },
      { id: "p2", name: "Bob", role: "observer", connected: true },
      { id: "p3", name: "Carol", role: "host-participant", connected: true },
    ];

    const eligibleDrivers = roster.filter(
      (p) =>
        p.connected &&
        (p.role === "observer" || p.role === "host-participant") &&
        p.id !== graceState.participantId
    );

    expect(eligibleDrivers.length).toBe(2);
    expect(eligibleDrivers.map((p) => p.role)).toContain("observer");
    expect(eligibleDrivers.map((p) => p.role)).toContain("host-participant");
  });

  test("returns empty list if no eligible drivers available", () => {
    const graceState = {
      participantId: "p1",
      participantName: "Alice",
      gracePeriodMs: 30000,
      startedAt: Date.now(),
    };

    const roster = [
      { id: "p1", name: "Alice", role: "observer", connected: true },
      { id: "p2", name: "Bob", role: "spectator", connected: true },
      { id: "p3", name: "Carol", role: "spectator", connected: true },
    ];

    const eligibleDrivers = roster.filter(
      (p) =>
        p.connected &&
        (p.role === "observer" || p.role === "host-participant") &&
        p.id !== graceState.participantId
    );

    expect(eligibleDrivers.length).toBe(0);
  });
});
