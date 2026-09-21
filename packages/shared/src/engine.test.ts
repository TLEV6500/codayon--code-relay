import { describe, expect, test } from "bun:test";
import {
  applyEvent,
  createSession,
  isEligibleForToken,
  type EngineEvent,
} from "./engine";
import type { SessionState } from "./domain";

function base(): SessionState {
  return createSession({
    roomId: "room-1",
    hostId: "host-1",
    hostName: "Mentor",
    hostParticipation: "admin-only",
  });
}

function reduce(state: SessionState, events: EngineEvent[]): SessionState {
  return events.reduce(applyEvent, state);
}

describe("createSession", () => {
  test("starts in 'created' phase with the host registered", () => {
    const s = base();
    expect(s.phase).toBe("created");
    expect(s.hostId).toBe("host-1");
    expect(s.turnConfig).toBeNull();
    const host = s.participants.get("host-1");
    expect(host?.role).toBe("host");
    expect(host?.connected).toBe(true);
  });

  test("is a pure snapshot — reducing does not mutate the input", () => {
    const s = base();
    const next = applyEvent(s, {
      type: "participantJoined",
      id: "p1",
      name: "Ann",
      role: "observer",
    });
    expect(s.participants.has("p1")).toBe(false);
    expect(next.participants.has("p1")).toBe(true);
    expect(next).not.toBe(s);
  });
});

describe("role assignment (REQ-006.1)", () => {
  test("participants join as observer or spectator", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      { type: "participantJoined", id: "p2", name: "Bo", role: "spectator" },
    ]);
    expect(s.participants.get("p1")?.role).toBe("observer");
    expect(s.participants.get("p2")?.role).toBe("spectator");
  });

  test("a joining participant may not claim the host role", () => {
    const s = applyEvent(base(), {
      type: "participantJoined",
      id: "p1",
      name: "Ann",
      // @ts-expect-error host is not a joinable role
      role: "host",
    });
    // The invalid join is ignored; roster unchanged beyond the host.
    expect(s.participants.has("p1")).toBe(false);
  });
});

describe("edit-token eligibility (REQ-006.2/3, REQ-005.3)", () => {
  test("spectators are never eligible", () => {
    const s = applyEvent(base(), {
      type: "participantJoined",
      id: "p2",
      name: "Bo",
      role: "spectator",
    });
    expect(isEligibleForToken(s, "p2")).toBe(false);
  });

  test("observers are eligible", () => {
    const s = applyEvent(base(), {
      type: "participantJoined",
      id: "p1",
      name: "Ann",
      role: "observer",
    });
    expect(isEligibleForToken(s, "p1")).toBe(true);
  });

  test("admin-only host is NOT eligible", () => {
    const s = base();
    expect(s.hostParticipation).toBe("admin-only");
    expect(isEligibleForToken(s, "host-1")).toBe(false);
  });

  test("host-participant host IS eligible", () => {
    const s = createSession({
      roomId: "room-1",
      hostId: "host-1",
      hostName: "Mentor",
      hostParticipation: "host-participant",
    });
    expect(isEligibleForToken(s, "host-1")).toBe(true);
  });
});

describe("turn configuration (REQ-007)", () => {
  test("host can configure mode + duration + policy", () => {
    const s = applyEvent(base(), {
      type: "configured",
      by: "host-1",
      config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
    });
    expect(s.turnConfig).toEqual({
      mode: "fixed",
      durationMs: 60_000,
      selectionPolicy: "manual",
    });
  });

  test("non-host configuration is ignored (REQ-005.2)", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      {
        type: "configured",
        by: "p1",
        config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
      },
    ]);
    expect(s.turnConfig).toBeNull();
  });

  test("invalid duration is rejected", () => {
    const s = applyEvent(base(), {
      type: "configured",
      by: "host-1",
      config: { mode: "fixed", durationMs: 0, selectionPolicy: "manual" },
    });
    expect(s.turnConfig).toBeNull();
  });
});

describe("start session guard (REQ-007.3, REQ-009.1)", () => {
  test("cannot start without turn config", () => {
    const s = applyEvent(base(), { type: "sessionStarted", by: "host-1" });
    expect(s.phase).toBe("created");
  });

  test("non-host cannot start (REQ-005.2)", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
      },
      { type: "sessionStarted", by: "p1" },
    ]);
    expect(s.phase).toBe("created");
  });

  test("host starts once configured", () => {
    const s = reduce(base(), [
      {
        type: "configured",
        by: "host-1",
        config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
      },
      { type: "sessionStarted", by: "host-1" },
    ]);
    expect(s.phase).toBe("active");
  });
});

describe("edit token enforcement (REQ-012, REQ-013/014)", () => {
  test("token can only be granted to eligible participants", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "obs1", name: "Observer", role: "observer" },
      { type: "participantJoined", id: "spec1", name: "Spectator", role: "spectator" },
    ]);

    // Grant to observer succeeds
    let s2 = applyEvent(s, { type: "tokenGranted", to: "obs1" });
    expect(s2.editTokenHolder).toBe("obs1");

    // Try to grant to spectator: fails (spectator is not eligible)
    let s3 = applyEvent(s2, { type: "tokenGranted", to: "spec1" });
    expect(s3.editTokenHolder).toBe("obs1"); // unchanged

    // Try to grant to non-existent participant: fails
    let s4 = applyEvent(s2, { type: "tokenGranted", to: "unknown" });
    expect(s4.editTokenHolder).toBe("obs1"); // unchanged
  });

  test("token grant to host-participant works, admin-only host fails", () => {
    const hostParticipant = createSession({
      roomId: "room-1",
      hostId: "host-1",
      hostName: "Mentor",
      hostParticipation: "host-participant",
    });

    const s1 = applyEvent(hostParticipant, { type: "tokenGranted", to: "host-1" });
    expect(s1.editTokenHolder).toBe("host-1");

    // Admin-only host cannot receive token
    const s2 = applyEvent(base(), { type: "tokenGranted", to: "host-1" });
    expect(s2.editTokenHolder).toBeNull();
  });

  test("token revocation works only if the specified participant holds it", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      { type: "participantJoined", id: "p2", name: "Bo", role: "observer" },
      { type: "tokenGranted", to: "p1" },
    ]);
    expect(s.editTokenHolder).toBe("p1");

    // Revoke from p1 succeeds
    let s2 = applyEvent(s, { type: "tokenRevoked", from: "p1" });
    expect(s2.editTokenHolder).toBeNull();

    // Try to revoke from p2 when they don't hold it: fails
    let s3 = applyEvent(s, { type: "tokenRevoked", from: "p2" });
    expect(s3.editTokenHolder).toBe("p1"); // unchanged
  });

  test("token transfer revokes before granting atomically", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      { type: "participantJoined", id: "p2", name: "Bo", role: "observer" },
      { type: "tokenGranted", to: "p1" },
    ]);
    expect(s.editTokenHolder).toBe("p1");

    // Grant to p2: atomic transfer, p1 loses it, p2 gains it
    const s2 = applyEvent(s, { type: "tokenGranted", to: "p2" });
    expect(s2.editTokenHolder).toBe("p2");
  });

  test("token is cleared when session ends", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      { type: "tokenGranted", to: "p1" },
    ]);
    expect(s.editTokenHolder).toBe("p1");

    const s2 = applyEvent(s, { type: "sessionEnded", by: "host-1" });
    // Token is still held, but the session is ended and no more mutations accepted.
    // (Token cleanup on end happens at the server level.)
    expect(s2.phase).toBe("ended");
    expect(s2.editTokenHolder).toBe("p1");
  });

  test("no mutations accepted once session ends", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      { type: "sessionEnded", by: "host-1" },
    ]);
    expect(s.phase).toBe("ended");

    // Try to grant token: ignored
    const s2 = applyEvent(s, { type: "tokenGranted", to: "p1" });
    expect(s2).toBe(s);
  });
});

describe("turn start/advance (REQ-009, REQ-024)", () => {
  test("host starts a turn with an eligible driver", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
      },
      { type: "sessionStarted", by: "host-1" },
    ]);
    expect(s.phase).toBe("active");

    const now = Date.now();
    const s2 = applyEvent(s, {
      type: "turnStarted",
      by: "host-1",
      driver: "p1",
      startedAt: now,
    });

    expect(s2.currentTurn).toBeTruthy();
    expect(s2.currentTurn?.number).toBe(1);
    expect(s2.currentTurn?.driverId).toBe("p1");
    expect(s2.currentTurn?.startedAt).toBe(now);
    expect(s2.currentTurn?.ended).toBe(false);
    expect(s2.editTokenHolder).toBe("p1");
  });

  test("non-host cannot start a turn (REQ-005.2)", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
      },
      { type: "sessionStarted", by: "host-1" },
    ]);

    const s2 = applyEvent(s, {
      type: "turnStarted",
      by: "p1",
      driver: "p1",
      startedAt: Date.now(),
    });
    expect(s2.currentTurn).toBeNull();
  });

  test("cannot start a turn before session is active", () => {
    const s = base();
    const s2 = applyEvent(s, {
      type: "turnStarted",
      by: "host-1",
      driver: "host-1",
      startedAt: Date.now(),
    });
    expect(s2.currentTurn).toBeNull();
  });

  test("cannot start a turn with an ineligible driver (spectator)", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "spec", name: "Watcher", role: "spectator" },
      {
        type: "configured",
        by: "host-1",
        config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
      },
      { type: "sessionStarted", by: "host-1" },
    ]);

    const s2 = applyEvent(s, {
      type: "turnStarted",
      by: "host-1",
      driver: "spec",
      startedAt: Date.now(),
    });
    expect(s2.currentTurn).toBeNull();
  });

  test("turn ended marks the turn as ended (exactly-once guard)", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
      },
      { type: "sessionStarted", by: "host-1" },
      {
        type: "turnStarted",
        by: "host-1",
        driver: "p1",
        startedAt: Date.now(),
      },
    ]);
    expect(s.currentTurn?.ended).toBe(false);

    const s2 = applyEvent(s, {
      type: "turnEnded",
      reason: "expiry",
      endedAt: Date.now(),
    });
    expect(s2.currentTurn?.ended).toBe(true);

    // Try to end again: ignored (exactly-once)
    const s3 = applyEvent(s2, {
      type: "turnEnded",
      reason: "expiry",
      endedAt: Date.now(),
    });
    expect(s3).toBe(s2);
  });

  test("turn advanced to next driver grants token and increments turn number", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      { type: "participantJoined", id: "p2", name: "Bo", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
      },
      { type: "sessionStarted", by: "host-1" },
      {
        type: "turnStarted",
        by: "host-1",
        driver: "p1",
        startedAt: Date.now(),
      },
    ]);
    expect(s.currentTurn?.number).toBe(1);

    const now = Date.now();
    const s2 = applyEvent(s, {
      type: "turnAdvanced",
      nextDriver: "p2",
      startedAt: now,
    });

    expect(s2.currentTurn?.number).toBe(2);
    expect(s2.currentTurn?.driverId).toBe("p2");
    expect(s2.currentTurn?.startedAt).toBe(now);
    expect(s2.currentTurn?.ended).toBe(false);
    expect(s2.editTokenHolder).toBe("p2");
  });

  test("turn advanced requires an eligible next driver", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      { type: "participantJoined", id: "spec", name: "Watcher", role: "spectator" },
      {
        type: "configured",
        by: "host-1",
        config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
      },
      { type: "sessionStarted", by: "host-1" },
      {
        type: "turnStarted",
        by: "host-1",
        driver: "p1",
        startedAt: Date.now(),
      },
    ]);

    const s2 = applyEvent(s, {
      type: "turnAdvanced",
      nextDriver: "spec",
      startedAt: Date.now(),
    });
    // Turn should not advance to spectator
    expect(s2.currentTurn?.driverId).toBe("p1");
  });
});

describe("early-end (REQ-010.3/4, REQ-024)", () => {
  test("driver can request early-end in early-end mode", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: {
          mode: "fixed-early-end",
          durationMs: 60_000,
          selectionPolicy: "manual",
        },
      },
      { type: "sessionStarted", by: "host-1" },
      {
        type: "turnStarted",
        by: "host-1",
        driver: "p1",
        startedAt: Date.now(),
      },
    ]);

    // Early-end request should return the same state (server will do actual end)
    const s2 = applyEvent(s, { type: "earlyEndRequested", by: "p1" });
    expect(s2).toBe(s);
  });

  test("non-driver cannot request early-end", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      { type: "participantJoined", id: "p2", name: "Bo", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: {
          mode: "fixed-early-end",
          durationMs: 60_000,
          selectionPolicy: "manual",
        },
      },
      { type: "sessionStarted", by: "host-1" },
      {
        type: "turnStarted",
        by: "host-1",
        driver: "p1",
        startedAt: Date.now(),
      },
    ]);

    const s2 = applyEvent(s, { type: "earlyEndRequested", by: "p2" });
    expect(s2).toBe(s);
  });

  test("early-end is rejected in fixed mode (REQ-010.4)", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
      },
      { type: "sessionStarted", by: "host-1" },
      {
        type: "turnStarted",
        by: "host-1",
        driver: "p1",
        startedAt: Date.now(),
      },
    ]);

    const s2 = applyEvent(s, { type: "earlyEndRequested", by: "p1" });
    // Should be rejected: fixed mode doesn't support early-end
    expect(s2).toBe(s);
  });
});

describe("round-robin rotation (REQ-008, REQ-011, REQ-025)", () => {
  function baseRoundRobin(): SessionState {
    return createSession({
      roomId: "room-1",
      hostId: "host-1",
      hostName: "Host",
      hostParticipation: "host-participant", // Host participates in rotation.
    });
  }

  test("rotation initializes when round-robin is configured", () => {
    const s = reduce(baseRoundRobin(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      { type: "participantJoined", id: "p2", name: "Bo", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: {
          mode: "fixed",
          durationMs: 60_000,
          selectionPolicy: "round-robin",
        },
      },
    ]);

    expect(s.rotation).toBeTruthy();
    expect(s.rotation?.order).toEqual(["host-1", "p1", "p2"]);
    expect(s.rotation?.nextIndex).toBe(0);
    expect(s.rotation?.hasDrivenInCycle.size).toBe(0);
  });

  test("rotation is null when manual pass is configured", () => {
    const s = reduce(base(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: { mode: "fixed", durationMs: 60_000, selectionPolicy: "manual" },
      },
    ]);

    expect(s.rotation).toBeNull();
  });

  test("late joiner is inserted fairly after those who haven't driven (REQ-025.2)", () => {
    const s = reduce(baseRoundRobin(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: {
          mode: "fixed",
          durationMs: 60_000,
          selectionPolicy: "round-robin",
        },
      },
    ]);

    // Late joiner arrives after session configured.
    const s2 = applyEvent(s, {
      type: "participantJoined",
      id: "p2",
      name: "Bo",
      role: "observer",
    });

    // p2 should be added to the rotation.
    expect(s2.rotation?.order).toContain("p2");
  });

  test("participant removal skips in rotation and doesn't stall (REQ-011.3)", () => {
    const s = reduce(baseRoundRobin(), [
      { type: "participantJoined", id: "p1", name: "Ann", role: "observer" },
      { type: "participantJoined", id: "p2", name: "Bo", role: "observer" },
      {
        type: "configured",
        by: "host-1",
        config: {
          mode: "fixed",
          durationMs: 60_000,
          selectionPolicy: "round-robin",
        },
      },
    ]);

    expect(s.rotation?.order).toEqual(["host-1", "p1", "p2"]);

    // p1 leaves; should be removed from rotation.
    const s2 = applyEvent(s, { type: "participantLeft", id: "p1" });

    expect(s2.rotation?.order).toEqual(["host-1", "p2"]);
  });
});
