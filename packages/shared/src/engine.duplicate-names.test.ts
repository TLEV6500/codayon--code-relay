/**
 * GAP-DOCUMENTATION TEST — Duplicate names are permitted on the roster (pure engine).
 *
 * See docs/bugfixes/GAPS-duplicate-names-host-disconnect-rejoin.md (Gap 1) for
 * full root-cause analysis.
 *
 * `applyEvent`'s `"participantJoined"` case (engine.ts, ~line 236) keys
 * participants exclusively by `ParticipantId` (an opaque generated string).
 * `name` is accepted verbatim with no uniqueness check against any other
 * entry already in `state.participants` — including the host's own name.
 *
 * These tests assert the CURRENT (permissive) behavior. They are expected to
 * PASS: there is no exception, crash, or rejection to observe — the "bug" is
 * the absence of a check, not an error path. No production code (engine.ts)
 * is modified or fixed here, per explicit product decision.
 */

import { describe, expect, test } from "bun:test";
import { applyEvent, createSession } from "./engine";
import type { SessionState } from "./domain";

function base(): SessionState {
  return createSession({
    roomId: "room-1",
    hostId: "host-1",
    hostName: "Mentor",
    hostParticipation: "admin-only",
  });
}

describe("GAP: duplicate names are permitted on join (pure engine)", () => {
  test("two participants can join with the exact same name", () => {
    const s1 = applyEvent(base(), {
      type: "participantJoined",
      id: "p1",
      name: "Bob",
      role: "observer",
    });
    const s2 = applyEvent(s1, {
      type: "participantJoined",
      id: "p2",
      name: "Bob",
      role: "observer",
    });

    // Both distinct participant records coexist with the identical name.
    expect(s2.participants.size).toBe(3); // host + p1 + p2
    expect(s2.participants.get("p1")?.name).toBe("Bob");
    expect(s2.participants.get("p2")?.name).toBe("Bob");
    expect(s2.participants.get("p1")?.id).not.toBe(s2.participants.get("p2")?.id);
  });

  test("case-variant names are treated as distinct and both permitted", () => {
    const s1 = applyEvent(base(), {
      type: "participantJoined",
      id: "p1",
      name: "Bob",
      role: "observer",
    });
    const s2 = applyEvent(s1, {
      type: "participantJoined",
      id: "p2",
      name: "bob", // case-variant of the same name
      role: "observer",
    });

    expect(s2.participants.get("p1")?.name).toBe("Bob");
    expect(s2.participants.get("p2")?.name).toBe("bob");
    // No case-insensitive collision detection: both entries persist verbatim.
    const names = [...s2.participants.values()].map((p) => p.name.toLowerCase());
    expect(names.filter((n) => n === "bob").length).toBe(2);
  });

  test("a joining participant's name can collide with the host's own name", () => {
    const s = applyEvent(base(), {
      type: "participantJoined",
      id: "p1",
      name: "Mentor", // identical to hostName above
      role: "observer",
    });

    const host = s.participants.get("host-1");
    const joiner = s.participants.get("p1");
    expect(host?.name).toBe("Mentor");
    expect(joiner?.name).toBe("Mentor");
    expect(host?.role).toBe("host");
    expect(joiner?.role).toBe("observer");
  });

  test("a 'rejoin' with the same name after a disconnect produces two roster rows, not one", () => {
    // Original join.
    let s = applyEvent(base(), {
      type: "participantJoined",
      id: "p1",
      name: "Ann",
      role: "observer",
    });

    // Simulate disconnect (participant remains in the roster, marked disconnected).
    s = applyEvent(s, { type: "connectionChanged", id: "p1", connected: false });
    expect(s.participants.get("p1")?.connected).toBe(false);

    // "Rejoin" in this system always mints a brand-new participant id (there is
    // no reconnect-by-name path), so the same display name joins fresh.
    s = applyEvent(s, {
      type: "participantJoined",
      id: "p2",
      name: "Ann",
      role: "observer",
    });

    // Two distinct "Ann" entries now coexist: the stale disconnected one and
    // the fresh rejoined one. Nothing merges or replaces the old record.
    const annEntries = [...s.participants.values()].filter((p) => p.name === "Ann");
    expect(annEntries.length).toBe(2);
    expect(annEntries.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(annEntries.find((p) => p.id === "p1")?.connected).toBe(false);
    expect(annEntries.find((p) => p.id === "p2")?.connected).toBe(true);
  });
});
