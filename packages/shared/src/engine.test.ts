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
