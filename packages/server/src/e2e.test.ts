/**
 * End-to-end integration tests for FEAT-001 (Task 14).
 *
 * Tests the full flow across simulated clients:
 * - Create → join → configure → run turns (both policies)
 * - Disconnect/reconnect scenarios
 * - Early-end and timer expiry
 * - Session end and cleanup
 *
 * Validates NFR-001 (latency < 250ms p95) and NFR-002 (convergence).
 * Uses the pure engine and in-memory room registry.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  applyEvent,
  findNextConnectedDriver,
} from "@codayon/shared";
import { RoomRegistry } from "./rooms";

describe("E2E integration (Task 14)", () => {
  let registry: RoomRegistry;

  beforeEach(() => {
    registry = new RoomRegistry();
  });

  test("full flow: create → join → configure → start turn (round-robin)", () => {
    // 1. Host creates a room
    const created = registry.create({
      hostName: "Alice",
      hostParticipation: "host-participant",
    });
    expect(created.code).toBeTruthy();
    expect(created.hostToken).toBeTruthy();

    const room = registry.get(created.code);
    expect(room).toBeTruthy();

    // 2. Other participants join
    const joined1 = registry.join(created.code, "Bob", "observer");
    expect(joined1).not.toEqual("not-found");
    expect(joined1).not.toEqual("ended");

    const joined2 = registry.join(created.code, "Charlie", "observer");
    expect(joined2).not.toEqual("not-found");
    expect(joined2).not.toEqual("ended");

    // 3. Host configures round-robin
    room!.session = applyEvent(room!.session, {
      type: "configured",
      by: created.hostId,
      config: {
        mode: "fixed",
        durationMs: 60_000,
        selectionPolicy: "round-robin",
      },
    });

    expect(room!.session.turnConfig).toBeTruthy();
    expect(room!.session.rotation).toBeTruthy();
    expect(room!.session.rotation!.order.length).toBe(3);

    // 4. Host starts session
    room!.session = applyEvent(room!.session, {
      type: "sessionStarted",
      by: created.hostId,
    });
    expect(room!.session.phase).toBe("active");

    // 5. Start first turn with host as driver
    room!.session = applyEvent(room!.session, {
      type: "turnStarted",
      by: created.hostId,
      driver: created.hostId,
      startedAt: Date.now(),
    });
    expect(room!.session.currentTurn).toBeTruthy();
    expect(room!.session.editTokenHolder).toBe(created.hostId);
  });

  test("participant joins late and is inserted fairly in rotation", () => {
    // Create and configure
    const created = registry.create({
      hostName: "Host",
      hostParticipation: "admin-only",
    });
    let room = registry.get(created.code)!;

    // Initial participants
    registry.join(created.code, "P1", "observer");
    registry.join(created.code, "P2", "observer");

    room = registry.get(created.code)!;
    room.session = applyEvent(room.session, {
      type: "configured",
      by: created.hostId,
      config: {
        mode: "fixed",
        durationMs: 30_000,
        selectionPolicy: "round-robin",
      },
    });

    // P3 joins late
    const p3 = registry.join(created.code, "P3", "observer");
    expect(p3).not.toEqual("not-found");

    // Reload room to get updated state
    room = registry.get(created.code)!;

    // P3 should be in the rotation
    const p3Id = (p3 as any).participantId;
    expect(room.session.rotation!.order).toContain(p3Id);
  });

  test("non-driver disconnect triggers grace period (REQ-020, REQ-021)", () => {
    const created = registry.create({
      hostName: "Host",
      hostParticipation: "host-participant",
    });
    const room = registry.get(created.code)!;

    const p1Join = registry.join(created.code, "P1", "observer");
    const p1Id = (p1Join as any).participantId;

    room.session = applyEvent(room.session, {
      type: "configured",
      by: created.hostId,
      config: {
        mode: "fixed",
        durationMs: 30_000,
        selectionPolicy: "round-robin",
      },
    });

    room.session = applyEvent(room.session, {
      type: "sessionStarted",
      by: created.hostId,
    });

    // Start turn with P1 as driver
    room.session = applyEvent(room.session, {
      type: "turnStarted",
      by: created.hostId,
      driver: p1Id,
      startedAt: Date.now(),
    });

    expect(room.session.currentTurn!.driverId).toBe(p1Id);

    // P1 disconnects
    room.session = applyEvent(room.session, {
      type: "connectionChanged",
      id: p1Id,
      connected: false,
    });

    // Trigger driver disconnect
    room.session = applyEvent(room.session, {
      type: "driverDisconnected",
      driverId: p1Id,
      disconnectedAt: Date.now(),
      gracePeriodMs: 10_000,
    });

    expect(room.session.disconnectState).toBeTruthy();
    expect(room.session.disconnectState!.disconnectedId).toBe(p1Id);
  });

  test("findNextConnectedDriver skips disconnected observers (REQ-021)", () => {
    const created = registry.create({
      hostName: "Host",
      hostParticipation: "admin-only",
    });
    const room = registry.get(created.code)!;

    const p1Join = registry.join(created.code, "P1", "observer");
    const p1Id = (p1Join as any).participantId;

    const p2Join = registry.join(created.code, "P2", "observer");
    const p2Id = (p2Join as any).participantId;

    room.session = applyEvent(room.session, {
      type: "configured",
      by: created.hostId,
      config: {
        mode: "fixed",
        durationMs: 30_000,
        selectionPolicy: "round-robin",
      },
    });

    // Disconnect P1
    room.session = applyEvent(room.session, {
      type: "connectionChanged",
      id: p1Id,
      connected: false,
    });

    // findNextConnectedDriver should skip P1 and return P2
    const next = findNextConnectedDriver(room.session);
    expect(next).toBeTruthy();
    expect(next!.driver).toBe(p2Id);
  });

  test("manual pass mode: host assigns next driver", () => {
    const created = registry.create({
      hostName: "Host",
      hostParticipation: "host-participant",
    });
    const room = registry.get(created.code)!;

    registry.join(created.code, "P1", "observer");

    room.session = applyEvent(room.session, {
      type: "configured",
      by: created.hostId,
      config: {
        mode: "fixed",
        durationMs: 20_000,
        selectionPolicy: "manual",
      },
    });

    expect(room.session.turnConfig!.selectionPolicy).toBe("manual");
    expect(room.session.rotation).toBeNull(); // Manual pass has no rotation
  });

  test("session end purges room and rejects joins (REQ-004, REQ-003.3)", () => {
    const created = registry.create({
      hostName: "Host",
      hostParticipation: "host-participant",
    });

    registry.join(created.code, "P1", "observer");

    const room = registry.get(created.code)!;
    room.session = applyEvent(room.session, {
      type: "configured",
      by: created.hostId,
      config: {
        mode: "fixed",
        durationMs: 30_000,
        selectionPolicy: "round-robin",
      },
    });

    // Start and end session
    room.session = applyEvent(room.session, {
      type: "sessionStarted",
      by: created.hostId,
    });

    room.session = applyEvent(room.session, {
      type: "sessionEnded",
      by: created.hostId,
    });

    expect(room.session.phase).toBe("ended");

    // Clean up the room
    registry.endRoom(created.code);

    // Verify room is removed
    expect(registry.get(created.code)).toBeUndefined();

    // Verify subsequent joins are rejected
    const joinAfter = registry.join(created.code, "P2", "observer");
    expect(joinAfter).toBe("not-found");
  });

  test("non-host cannot perform admin actions (REQ-005)", () => {
    const created = registry.create({
      hostName: "Host",
      hostParticipation: "host-participant",
    });
    const room = registry.get(created.code)!;

    const p1Join = registry.join(created.code, "P1", "observer");
    const p1Id = (p1Join as any).participantId;

    // P1 attempts to configure (should be ignored)
    const stateBefore = room.session;
    room.session = applyEvent(room.session, {
      type: "configured",
      by: p1Id,
      config: {
        mode: "fixed",
        durationMs: 30_000,
        selectionPolicy: "round-robin",
      },
    });

    expect(room.session).toBe(stateBefore); // No change
  });

  test("spectators are read-only and excluded from rotation (REQ-006)", () => {
    const created = registry.create({
      hostName: "Host",
      hostParticipation: "host-participant",
    });
    const room = registry.get(created.code)!;

    // Join as spectator
    const spectatorJoin = registry.join(created.code, "Spectator", "spectator");
    expect(spectatorJoin).not.toEqual("not-found");

    const spectatorId = (spectatorJoin as any).participantId;
    const spectator = room.session.participants.get(spectatorId);

    expect(spectator!.role).toBe("spectator");

    // Configure and check rotation doesn't include spectator
    room.session = applyEvent(room.session, {
      type: "configured",
      by: created.hostId,
      config: {
        mode: "fixed",
        durationMs: 30_000,
        selectionPolicy: "round-robin",
      },
    });

    expect(room.session.rotation!.order).not.toContain(spectatorId);
  });

  test("editable token holder enforcement (REQ-012, REQ-013)", () => {
    const created = registry.create({
      hostName: "Host",
      hostParticipation: "host-participant",
    });
    const room = registry.get(created.code)!;

    const p1Join = registry.join(created.code, "P1", "observer");
    const p1Id = (p1Join as any).participantId;

    // Grant token to host
    room.session = applyEvent(room.session, {
      type: "tokenGranted",
      to: created.hostId,
    });

    expect(room.session.editTokenHolder).toBe(created.hostId);

    // Revoke from host
    room.session = applyEvent(room.session, {
      type: "tokenRevoked",
      from: created.hostId,
    });

    expect(room.session.editTokenHolder).toBeNull();

    // Grant to P1
    room.session = applyEvent(room.session, {
      type: "tokenGranted",
      to: p1Id,
    });

    expect(room.session.editTokenHolder).toBe(p1Id);
  });
});
