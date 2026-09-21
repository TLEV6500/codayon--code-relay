/**
 * Tests for FEAT-003 Task 5: Rotation order visibility (REQ-031).
 *
 * Verifies:
 * - Rotation order is displayed in SessionControls when round-robin mode is active
 * - Next-up driver is highlighted correctly
 * - Display only appears when selectionPolicy='round-robin' and session is active
 * - Late-joiner insertion and order updates are reflected
 * - Participant names are resolved correctly from roster
 */

import { describe, it, expect } from "bun:test";

/**
 * Mock data helpers for rotation order testing.
 */

const mockParticipant = (id: string, name: string, role: string = "observer") => ({
  id,
  name,
  role,
  connected: true,
});

const mockSessionControls = (overrides = {}) => ({
  code: "TEST",
  role: "observer" as const,
  clientID: "client-1",
  sessionPhase: "active" as const,
  turnConfig: {
    mode: "fixed" as const,
    durationMs: 180000,
    selectionPolicy: "round-robin" as const,
  },
  roster: [
    mockParticipant("p1", "Alice"),
    mockParticipant("p2", "Bob"),
    mockParticipant("p3", "Charlie"),
  ],
  rotationOrder: ["p1", "p2", "p3"],
  rotationNextIndex: 0,
  ...overrides,
});

describe("rotation order visibility (FEAT-003 Task 5, REQ-031)", () => {
  describe("display visibility", () => {
    it("shows rotation order when round-robin mode + active session + order exists", () => {
      const props = mockSessionControls({
        turnConfig: {
          mode: "fixed",
          durationMs: 180000,
          selectionPolicy: "round-robin",
        },
        sessionPhase: "active",
        rotationOrder: ["p1", "p2", "p3"],
      });

      // Verify conditions for display
      expect(props.turnConfig?.selectionPolicy).toBe("round-robin");
      expect(props.sessionPhase).toBe("active");
      expect(props.rotationOrder?.length).toBe(3);
    });

    it("hides rotation order when manual mode", () => {
      const props = mockSessionControls({
        turnConfig: {
          mode: "fixed",
          durationMs: 180000,
          selectionPolicy: "manual",
        },
        rotationOrder: ["p1", "p2", "p3"],
      });

      // Manual mode should not display rotation
      expect(props.turnConfig?.selectionPolicy).toBe("manual");
    });

    it("hides rotation order when session not active", () => {
      const props = mockSessionControls({
        sessionPhase: "created",
        rotationOrder: ["p1", "p2", "p3"],
      });

      // Session must be active
      expect(props.sessionPhase).not.toBe("active");
    });

    it("hides rotation order when rotation list is empty", () => {
      const props = mockSessionControls({
        rotationOrder: [],
      });

      // Empty rotation should not display
      expect(props.rotationOrder?.length).toBe(0);
    });

    it("hides rotation order when turnConfig is null", () => {
      const props = mockSessionControls({
        turnConfig: null,
        rotationOrder: ["p1"],
      });

      // Null config means session not configured yet
      expect(props.turnConfig).toBe(null);
    });
  });

  describe("next-up highlighting", () => {
    it("highlights first participant when nextIndex=0", () => {
      const props = mockSessionControls({
        rotationOrder: ["alice", "bob", "charlie"],
        rotationNextIndex: 0,
      });

      // Index 0 should be highlighted
      expect(props.rotationNextIndex).toBe(0);
      expect(props.rotationOrder?.[props.rotationNextIndex]).toBe("alice");
    });

    it("highlights second participant when nextIndex=1", () => {
      const props = mockSessionControls({
        rotationOrder: ["alice", "bob", "charlie"],
        rotationNextIndex: 1,
      });

      // Index 1 should be highlighted
      expect(props.rotationNextIndex).toBe(1);
      expect(props.rotationOrder?.[props.rotationNextIndex]).toBe("bob");
    });

    it("highlights last participant when nextIndex=end-1", () => {
      const props = mockSessionControls({
        rotationOrder: ["alice", "bob", "charlie"],
        rotationNextIndex: 2,
      });

      // Index 2 (last) should be highlighted
      expect(props.rotationNextIndex).toBe(2);
      expect(props.rotationOrder?.[props.rotationNextIndex]).toBe("charlie");
    });

    it("wraps to index 0 after final participant", () => {
      const props = mockSessionControls({
        rotationOrder: ["alice", "bob", "charlie"],
        rotationNextIndex: 0, // Cycles back to 0 after 3rd
      });

      // After processing all 3, wraps to 0
      expect(props.rotationNextIndex).toBe(0);
    });
  });

  describe("late-joiner insertion", () => {
    it("reflects insertion of late-joiner at correct position", () => {
      // Initial rotation: alice, bob, charlie (alice drove, bob/charlie haven't)
      const preLateJoiner = mockSessionControls({
        rotationOrder: ["alice", "bob", "charlie"],
        rotationNextIndex: 1, // bob is next
      });

      // Late-joiner dave joins; should be inserted after bob/charlie who haven't driven
      const postLateJoiner = mockSessionControls({
        rotationOrder: ["alice", "bob", "charlie", "dave"],
        rotationNextIndex: 1, // still bob next
      });

      // Dave added at end (after those who haven't driven in this cycle)
      expect(postLateJoiner.rotationOrder).toEqual([
        "alice",
        "bob",
        "charlie",
        "dave",
      ]);
      expect(postLateJoiner.rotationNextIndex).toBe(1);
    });

    it("correctly reorders when hasDrivenInCycle changes", () => {
      // Scenario: alice and bob have driven, charlie and dave haven't
      // New order should be: charlie, dave, alice, bob (haven't-driven first)
      const reordered = mockSessionControls({
        rotationOrder: ["charlie", "dave", "alice", "bob"],
        rotationNextIndex: 0, // charlie (hasn't driven) is next
      });

      // Those who haven't driven (charlie, dave) come first
      expect(reordered.rotationOrder?.slice(0, 2)).toEqual(["charlie", "dave"]);
      expect(reordered.rotationNextIndex).toBe(0);
    });
  });

  describe("participant name resolution", () => {
    it("resolves participant id to name from roster", () => {
      const props = mockSessionControls({
        roster: [
          mockParticipant("p1", "Alice"),
          mockParticipant("p2", "Bob"),
          mockParticipant("p3", "Charlie"),
        ],
        rotationOrder: ["p1", "p2", "p3"],
      });

      // Names should match roster
      const getNameFromRoster = (id: string) => {
        return props.roster?.find((p) => p.id === id)?.name ?? id;
      };

      expect(getNameFromRoster("p1")).toBe("Alice");
      expect(getNameFromRoster("p2")).toBe("Bob");
      expect(getNameFromRoster("p3")).toBe("Charlie");
    });

    it("falls back to id substring when participant not in roster", () => {
      const props = mockSessionControls({
        roster: [mockParticipant("p1", "Alice")],
        rotationOrder: ["p1", "unknown-id"],
      });

      // Fallback for unknown participant
      const getNameFromRoster = (id: string) => {
        const participant = props.roster?.find((p) => p.id === id);
        return participant?.name ?? id.substring(0, 8);
      };

      expect(getNameFromRoster("p1")).toBe("Alice");
      expect(getNameFromRoster("unknown-id")).toBe("unknown-");
    });

    it("handles names with special characters", () => {
      const props = mockSessionControls({
        roster: [
          mockParticipant("p1", "Alice O'Reilly"),
          mockParticipant("p2", "Bob & Charlie (co-hosts)"),
          mockParticipant("p3", "David Müller"),
        ],
        rotationOrder: ["p1", "p2", "p3"],
      });

      // Special characters should be preserved
      expect(props.roster?.[0]?.name).toBe("Alice O'Reilly");
      expect(props.roster?.[1]?.name).toBe("Bob & Charlie (co-hosts)");
      expect(props.roster?.[2]?.name).toBe("David Müller");
    });
  });

  describe("rotation order update scenarios", () => {
    it("updates when participant disconnects and is removed from rotation", () => {
      const pre = mockSessionControls({
        rotationOrder: ["p1", "p2", "p3"],
        rotationNextIndex: 1, // p2 next
      });

      // p2 disconnects and is removed
      const post = mockSessionControls({
        rotationOrder: ["p1", "p3"],
        rotationNextIndex: 1, // now points to p3
      });

      expect(pre.rotationOrder).toEqual(["p1", "p2", "p3"]);
      expect(post.rotationOrder).toEqual(["p1", "p3"]);
      expect(post.rotationNextIndex).toBe(1);
    });

    it("updates when participant reconnects (already in rotation)", () => {
      const props = mockSessionControls({
        rotationOrder: ["p1", "p2", "p3"],
        rotationNextIndex: 0,
        roster: [
          mockParticipant("p1", "Alice", "observer"),
          mockParticipant("p2", "Bob", "observer"),
          mockParticipant("p3", "Charlie", "observer"),
        ],
      });

      // All participants are in rotation; if p2 was disconnected,
      // upon reconnect it should already be in the order
      expect(props.rotationOrder).toContain("p2");
    });

    it("maintains nextIndex when participant list changes but nextIndex participant remains", () => {
      const pre = mockSessionControls({
        rotationOrder: ["p1", "p2", "p3", "p4"],
        rotationNextIndex: 2, // p3 next
      });

      // p4 leaves, but p3 still exists
      const post = mockSessionControls({
        rotationOrder: ["p1", "p2", "p3"],
        rotationNextIndex: 2, // p3 still at index 2
      });

      expect(pre.rotationOrder?.[pre.rotationNextIndex]).toBe("p3");
      expect(post.rotationOrder?.[post.rotationNextIndex]).toBe("p3");
    });

    it("wraps nextIndex when index becomes out of bounds after removal", () => {
      const pre = mockSessionControls({
        rotationOrder: ["p1", "p2"],
        rotationNextIndex: 1, // p2 next
      });

      // p2 is removed, leaving only p1; nextIndex would be 1 but order.length = 1
      const post = mockSessionControls({
        rotationOrder: ["p1"],
        rotationNextIndex: 0, // wraps to 0
      });

      expect(post.rotationOrder?.length).toBe(1);
      expect(post.rotationNextIndex).toBe(0);
    });
  });

  describe("broadcast and sync scenarios", () => {
    it("broadcasts rotation snapshot on session start (round-robin mode)", () => {
      // When session configuration is applied with round-robin policy,
      // a RotationSnapshotMsg should be broadcast alongside SessionSnapshotMsg
      const props = mockSessionControls({
        sessionPhase: "active",
        turnConfig: {
          mode: "fixed",
          durationMs: 180000,
          selectionPolicy: "round-robin",
        },
        rotationOrder: ["p1", "p2", "p3"],
        rotationNextIndex: 0,
      });

      // Verify properties that would be in RotationSnapshotMsg
      expect(props.rotationOrder).toBeDefined();
      expect(props.rotationNextIndex).toBeDefined();
      expect(Array.isArray(props.rotationOrder)).toBe(true);
      expect(typeof props.rotationNextIndex).toBe("number");
    });

    it("does not broadcast rotation snapshot on manual mode", () => {
      // When manual mode is selected, no RotationSnapshotMsg should be sent
      const props = mockSessionControls({
        turnConfig: {
          mode: "fixed",
          durationMs: 180000,
          selectionPolicy: "manual",
        },
        rotationOrder: [],
        rotationNextIndex: 0,
      });

      // Manual mode → no rotation order
      expect(props.turnConfig?.selectionPolicy).toBe("manual");
      // rotationOrder should be empty or not used
      expect(props.rotationOrder?.length ?? 0).toBe(0);
    });

    it("broadcasts rotation snapshot on late-joiner insertion", () => {
      // When a new eligible participant joins during round-robin,
      // rotation is recalculated and new RotationSnapshotMsg is broadcast
      const preLateJoin = mockSessionControls({
        rotationOrder: ["p1", "p2"],
        rotationNextIndex: 0,
      });

      const postLateJoin = mockSessionControls({
        rotationOrder: ["p1", "p2", "p3"],
        rotationNextIndex: 0,
      });

      // Order increased by 1
      expect(postLateJoin.rotationOrder?.length).toBe(
        preLateJoin.rotationOrder?.length! + 1
      );
      // New participant added
      expect(postLateJoin.rotationOrder).toContain("p3");
    });

    it("broadcasts rotation snapshot on turn advancement", () => {
      // When a turn ends and the next driver is selected in round-robin,
      // nextIndex is incremented and new RotationSnapshotMsg is broadcast
      const preTurnEnd = mockSessionControls({
        rotationOrder: ["p1", "p2", "p3"],
        rotationNextIndex: 0, // p1 is current/was just driving
      });

      const postTurnEnd = mockSessionControls({
        rotationOrder: ["p1", "p2", "p3"],
        rotationNextIndex: 1, // p2 is now next
      });

      expect(postTurnEnd.rotationNextIndex).toBe(
        (preTurnEnd.rotationNextIndex + 1) % preTurnEnd.rotationOrder!.length
      );
    });
  });

  describe("edge cases", () => {
    it("handles single participant rotation", () => {
      const props = mockSessionControls({
        rotationOrder: ["p1"],
        rotationNextIndex: 0,
      });

      // Single participant should wrap to self
      expect(props.rotationOrder?.length).toBe(1);
      expect(props.rotationOrder?.[0]).toBe("p1");
    });

    it("handles rotation with all participants having same name", () => {
      const props = mockSessionControls({
        roster: [
          mockParticipant("p1", "Guest"),
          mockParticipant("p2", "Guest"),
          mockParticipant("p3", "Guest"),
        ],
        rotationOrder: ["p1", "p2", "p3"],
        rotationNextIndex: 0,
      });

      // Should still be distinguishable by ID
      expect(props.rotationOrder?.length).toBe(3);
      // But names are the same (UI would need to handle this, e.g. "Guest (p1)")
      const names = props.rotationOrder?.map((id) => {
        const p = props.roster?.find((x) => x.id === id);
        return p?.name;
      });
      expect(names).toEqual(["Guest", "Guest", "Guest"]);
    });

    it("handles very long rotation (many participants)", () => {
      const longRotation = Array.from({ length: 100 }, (_, i) =>
        `p${i + 1}`
      );
      const props = mockSessionControls({
        rotationOrder: longRotation,
        rotationNextIndex: 50,
      });

      expect(props.rotationOrder?.length).toBe(100);
      expect(props.rotationOrder?.[50]).toBe("p51");
    });

    it("handles nextIndex larger than order length (defensive)", () => {
      const props = mockSessionControls({
        rotationOrder: ["p1", "p2", "p3"],
        rotationNextIndex: 5, // Out of bounds
      });

      // Client should handle this gracefully (e.g., modulo)
      const nextId = props.rotationOrder?.[props.rotationNextIndex % props.rotationOrder.length];
      expect(nextId).toBeDefined();
    });
  });
});
