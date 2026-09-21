import { describe, expect, test } from "bun:test";
import { RoomRegistry } from "./rooms";

/** Deterministic generators for stable assertions. */
function seededRegistry() {
  let codeN = 0;
  let tokenN = 0;
  let pidN = 0;
  return new RoomRegistry({
    roomCode: () => `ROOM${++codeN}`,
    token: () => `tok-${++tokenN}`,
    participantId: () => `p${++pidN}`,
  });
}

describe("RoomRegistry.create (REQ-001)", () => {
  test("creates a room with host token and host participant", () => {
    const reg = seededRegistry();
    const r = reg.create({ hostName: "Mentor", hostParticipation: "admin-only" });
    expect(r.code).toBe("ROOM1");
    expect(r.hostToken).toBeTruthy();
    expect(r.hostId).toBe("p1");
    const room = reg.get("ROOM1")!;
    expect(room.session.phase).toBe("created");
    expect(room.session.participants.get("p1")?.role).toBe("host");
    expect(reg.isHostToken("ROOM1", r.hostToken)).toBe(true);
    expect(reg.isHostToken("ROOM1", "wrong")).toBe(false);
  });

  test("host-participation is recorded", () => {
    const reg = seededRegistry();
    const r = reg.create({ hostName: "Mentor", hostParticipation: "host-participant" });
    expect(reg.get(r.code)!.session.hostParticipation).toBe("host-participant");
  });
});

describe("RoomRegistry.join (REQ-002)", () => {
  test("admits an observer and a spectator", () => {
    const reg = seededRegistry();
    const { code } = reg.create({ hostName: "M", hostParticipation: "admin-only" });
    const obs = reg.join(code, "Ann", "observer");
    const spec = reg.join(code, "Bo", "spectator");
    expect(obs).not.toBe("not-found");
    if (obs === "not-found" || obs === "ended") throw new Error("unexpected");
    if (spec === "not-found" || spec === "ended") throw new Error("unexpected");
    expect(obs.role).toBe("observer");
    expect(spec.role).toBe("spectator");
    expect(reg.resolveClient(code, obs.clientToken)).toBe(obs.participantId);
  });

  test("join to an unknown code returns not-found", () => {
    const reg = seededRegistry();
    expect(reg.join("NOPE", "Ann", "observer")).toBe("not-found");
  });

  test("join to an ended session returns ended (REQ-004.3)", () => {
    const reg = seededRegistry();
    const { code, hostToken } = reg.create({
      hostName: "M",
      hostParticipation: "admin-only",
    });
    // End the session via the engine directly through the room record.
    const room = reg.get(code)!;
    // simulate host-driven end (host authority verified at the HTTP layer)
    expect(reg.isHostToken(code, hostToken)).toBe(true);
    room.session = { ...room.session, phase: "ended" };
    expect(reg.join(code, "Late", "observer")).toBe("ended");
  });
});

describe("RoomRegistry.bootstrap (REQ-002.4)", () => {
  test("returns version, doc, phase and roster", () => {
    const reg = seededRegistry();
    const { code } = reg.create({ hostName: "M", hostParticipation: "admin-only" });
    reg.join(code, "Ann", "observer");
    const boot = reg.bootstrap(code);
    if (boot === "not-found" || boot === "ended") throw new Error("unexpected");
    expect(boot.version).toBe(0);
    expect(boot.doc).toBe("");
    expect(boot.phase).toBe("created");
    expect(boot.roster.map((r) => r.role).sort()).toEqual(["host", "observer"]);
  });
});
