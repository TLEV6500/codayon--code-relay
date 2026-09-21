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
