/**
 * GAP-DOCUMENTATION TEST — Duplicate names are permitted on join (registry level).
 *
 * See docs/bugfixes/GAPS-duplicate-names-host-disconnect-rejoin.md (Gap 1) for
 * full root-cause analysis.
 *
 * `RoomRegistry.join()` (rooms.ts) never checks whether `name` already exists
 * among a room's roster before delegating to the engine's `participantJoined`
 * event. Two independent `join()` calls with an identical `name` both
 * succeed, producing two roster rows with distinct `participantId`s.
 *
 * These tests assert the CURRENT (permissive) behavior at the registry/HTTP
 * boundary. They are expected to PASS — there is no rejection to observe.
 * No production code (rooms.ts) is modified or fixed here, per explicit
 * product decision.
 */

import { describe, expect, test } from "bun:test";
import { RoomRegistry } from "./rooms";

/** Deterministic generators for stable assertions (matches rooms.test.ts). */
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

describe("GAP: duplicate names are permitted on join (RoomRegistry)", () => {
  test("two independent joins with the identical name both succeed", () => {
    const reg = seededRegistry();
    const { code } = reg.create({ hostName: "Host", hostParticipation: "admin-only" });

    const first = reg.join(code, "Bob", "observer");
    const second = reg.join(code, "Bob", "observer");

    expect(first).not.toBe("not-found");
    expect(second).not.toBe("not-found");
    if (first === "not-found" || first === "ended") throw new Error("unexpected");
    if (second === "not-found" || second === "ended") throw new Error("unexpected");

    // Both joins succeeded with distinct participant identities.
    expect(first.participantId).not.toBe(second.participantId);

    const boot = reg.bootstrap(code);
    if (boot === "not-found" || boot === "ended") throw new Error("unexpected");

    const bobs = boot.roster.filter((r) => r.name === "Bob");
    expect(bobs.length).toBe(2);
    expect(bobs.map((b) => b.id).sort()).toEqual(
      [first.participantId, second.participantId].sort(),
    );
  });

  test("a joining participant's name can collide with the host's own name", () => {
    const reg = seededRegistry();
    const { code } = reg.create({ hostName: "Ann", hostParticipation: "admin-only" });

    reg.join(code, "Ann", "observer");

    const boot = reg.bootstrap(code);
    if (boot === "not-found" || boot === "ended") throw new Error("unexpected");

    const anns = boot.roster.filter((r) => r.name === "Ann");
    expect(anns.length).toBe(2);
    expect(anns.map((a) => a.role).sort()).toEqual(["host", "observer"]);
  });

  test("case-variant names ('Bob' vs 'bob') both persist as distinct roster entries", () => {
    const reg = seededRegistry();
    const { code } = reg.create({ hostName: "Host", hostParticipation: "admin-only" });

    reg.join(code, "Bob", "observer");
    reg.join(code, "bob", "spectator");

    const boot = reg.bootstrap(code);
    if (boot === "not-found" || boot === "ended") throw new Error("unexpected");

    const caseInsensitiveMatches = boot.roster.filter(
      (r) => r.name.toLowerCase() === "bob",
    );
    expect(caseInsensitiveMatches.length).toBe(2);
    // The exact casing supplied at join time is preserved verbatim for each.
    expect(caseInsensitiveMatches.map((r) => r.name).sort()).toEqual(["Bob", "bob"]);
  });
});
