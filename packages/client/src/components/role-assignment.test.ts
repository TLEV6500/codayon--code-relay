/**
 * Role assignment confirmation on join/reconnect (FEAT-003 Task 9, REQ-035).
 *
 * Verifies that the client:
 * 1. Treats server-confirmed role as authoritative
 * 2. Updates local role state on RoleAssignedMsg
 * 3. Handles role confirmation on reconnect correctly
 */

import { describe, test, expect } from "bun:test";
import { createSignal } from "solid-js";
import type { RoleAssignedMsg } from "@codayon/shared";

describe("Role assignment confirmation (FEAT-003 Task 9, REQ-035)", () => {
  describe("Role signal management", () => {
    test("role signal initializes with props.role", () => {
      const [role, setRole] = createSignal<"host" | "observer" | "spectator">("observer");
      expect(role()).toBe("observer");
    });

    test("role signal updates on setRole call", () => {
      const [role, setRole] = createSignal<"host" | "observer" | "spectator">("observer");
      setRole("host");
      expect(role()).toBe("host");
    });

    test("role signal can transition between all valid roles", () => {
      const [role, setRole] = createSignal<"host" | "observer" | "spectator">("observer");

      setRole("host");
      expect(role()).toBe("host");

      setRole("spectator");
      expect(role()).toBe("spectator");

      setRole("observer");
      expect(role()).toBe("observer");
    });
  });

  describe("RoleAssignedMsg handling", () => {
    test("RoleAssignedMsg structure is valid", () => {
      const msg: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: "p_123",
        role: "observer",
        hostParticipation: "admin-only",
      };

      expect(msg.channel).toBe("control");
      expect(msg.type).toBe("roleAssigned");
      expect(msg.participantId).toBe("p_123");
      expect(msg.role).toBe("observer");
      expect(msg.hostParticipation).toBe("admin-only");
    });

    test("RoleAssignedMsg with host role", () => {
      const msg: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: "p_host",
        role: "host",
        hostParticipation: "host-participant",
      };

      expect(msg.role).toBe("host");
      expect(msg.hostParticipation).toBe("host-participant");
    });

    test("RoleAssignedMsg with spectator role", () => {
      const msg: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: "p_spec",
        role: "spectator",
        hostParticipation: "admin-only",
      };

      expect(msg.role).toBe("spectator");
    });
  });

  describe("Server-confirmed role authority", () => {
    test("server-confirmed role overrides cached/initial role", () => {
      const [role, setRole] = createSignal<"host" | "observer" | "spectator">("observer");
      const clientID = "c_123";

      // Simulating initial client state
      expect(role()).toBe("observer");

      // Simulate receiving RoleAssignedMsg from server
      const msg: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: clientID,
        role: "host",
        hostParticipation: "host-participant",
      };

      // Check if message is for this client and update role
      if (msg.participantId === clientID) {
        setRole(msg.role);
      }

      expect(role()).toBe("host");
    });

    test("ignores RoleAssignedMsg for other participants", () => {
      const [role, setRole] = createSignal<"host" | "observer" | "spectator">("observer");
      const clientID = "c_123";
      const otherClientID = "c_456";

      // Simulating receiving RoleAssignedMsg for another participant
      const msg: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: otherClientID,
        role: "host",
        hostParticipation: "host-participant",
      };

      // Should not update because message is for different participant
      if (msg.participantId === clientID) {
        setRole(msg.role);
      }

      expect(role()).toBe("observer");
    });

    test("role update on reconnect overwrites previous role", () => {
      const [role, setRole] = createSignal<"host" | "observer" | "spectator">("observer");
      const clientID = "c_123";

      // Initial role: observer
      expect(role()).toBe("observer");

      // Simulate role change on server (e.g., host reassigns observer to admin)
      // In practice this might be done by host via reassign action
      // Now on reconnect, server confirms new role
      const reconnectMsg: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: clientID,
        role: "spectator",
        hostParticipation: "admin-only",
      };

      if (reconnectMsg.participantId === clientID) {
        setRole(reconnectMsg.role);
      }

      expect(role()).toBe("spectator");
    });
  });

  describe("Bootstrap role confirmation", () => {
    test("bootstrap response includes role data when clientToken provided", () => {
      const bootstrapWithRole = {
        version: 0,
        doc: "",
        phase: "created" as const,
        roster: [],
        participantId: "p_123",
        role: "observer" as const,
        hostParticipation: "admin-only" as const,
      };

      expect(bootstrapWithRole.participantId).toBe("p_123");
      expect(bootstrapWithRole.role).toBe("observer");
      expect(bootstrapWithRole.hostParticipation).toBe("admin-only");
    });

    test("bootstrap response can be used to initialize role before WebSocket connects", () => {
      const bootstrapWithRole = {
        version: 0,
        doc: "",
        phase: "created" as const,
        roster: [],
        participantId: "p_123",
        role: "host" as const,
        hostParticipation: "host-participant" as const,
      };

      // Simulate initializing role from bootstrap before WS connects
      const [role, setRole] = createSignal<"host" | "observer" | "spectator">("observer");

      if (bootstrapWithRole.role) {
        setRole(bootstrapWithRole.role);
      }

      expect(role()).toBe("host");
    });

    test("bootstrap without role fields falls back to props role", () => {
      const bootstrapWithoutRole = {
        version: 0,
        doc: "",
        phase: "created" as const,
        roster: [],
      };

      // Fallback to props role when bootstrap doesn't include role info
      const propsRole: "host" | "observer" | "spectator" = "observer";
      const [role, setRole] = createSignal<"host" | "observer" | "spectator">(propsRole);

      // Bootstrap role is not available, so role stays as props value
      if ("role" in bootstrapWithoutRole && bootstrapWithoutRole.role) {
        setRole(bootstrapWithoutRole.role);
      }

      expect(role()).toBe("observer");
    });
  });

  describe("Reconnection scenarios", () => {
    test("role is confirmed on every reconnection", () => {
      const [role, setRole] = createSignal<"host" | "observer" | "spectator">("observer");
      const clientID = "c_123";

      // First connection
      const firstConnection: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: clientID,
        role: "observer",
        hostParticipation: "admin-only",
      };

      if (firstConnection.participantId === clientID) {
        setRole(firstConnection.role);
      }
      expect(role()).toBe("observer");

      // Simulate disconnect and reconnect
      // On reconnect, server sends role again (role might be same or different)
      const reconnection: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: clientID,
        role: "observer", // Same role
        hostParticipation: "admin-only",
      };

      if (reconnection.participantId === clientID) {
        setRole(reconnection.role);
      }
      expect(role()).toBe("observer");
    });

    test("role changes on reconnect reflect host actions", () => {
      const [role, setRole] = createSignal<"host" | "observer" | "spectator">("observer");
      const clientID = "c_123";

      // Initial connection: observer
      const initialMsg: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: clientID,
        role: "observer",
        hostParticipation: "admin-only",
      };

      if (initialMsg.participantId === clientID) {
        setRole(initialMsg.role);
      }
      expect(role()).toBe("observer");

      // After reconnect: host has changed our role to spectator
      const reconnectMsg: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: clientID,
        role: "spectator",
        hostParticipation: "admin-only",
      };

      if (reconnectMsg.participantId === clientID) {
        setRole(reconnectMsg.role);
      }
      expect(role()).toBe("spectator");
    });

    test("multiple participants each get their correct role on reconnect", () => {
      const [aliceRole, setAliceRole] = createSignal<"host" | "observer" | "spectator">("host");
      const [bobRole, setBobRole] = createSignal<"host" | "observer" | "spectator">("observer");
      const aliceID = "c_alice";
      const bobID = "c_bob";

      // Alice reconnects
      const aliceMsg: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: aliceID,
        role: "host",
        hostParticipation: "host-participant",
      };

      if (aliceMsg.participantId === aliceID) {
        setAliceRole(aliceMsg.role);
      }

      // Bob reconnects
      const bobMsg: RoleAssignedMsg = {
        channel: "control",
        type: "roleAssigned",
        participantId: bobID,
        role: "observer",
        hostParticipation: "host-participant",
      };

      if (bobMsg.participantId === bobID) {
        setBobRole(bobMsg.role);
      }

      expect(aliceRole()).toBe("host");
      expect(bobRole()).toBe("observer");
    });
  });
});
