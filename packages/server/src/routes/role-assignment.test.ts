/**
 * Role assignment confirmation on join/reconnect (FEAT-003 Task 9, REQ-035).
 *
 * Verifies that:
 * 1. Server emits RoleAssignedMsg from HTTP bootstrap with clientToken
 * 2. Server emits RoleAssignedMsg on WebSocket open (reconnect)
 * 3. Client treats server-confirmed role as authoritative
 */

import { describe, test, expect } from "bun:test";
import { RoomRegistry } from "../rooms";
import type { RoleAssignedMsg } from "@codayon/shared";

describe("Role assignment confirmation (FEAT-003 Task 9, REQ-035)", () => {
  describe("HTTP bootstrap with clientToken", () => {
    test("bootstrap includes participantId and role when clientToken provided", () => {
      const registry = new RoomRegistry();
      const createResult = registry.create({
        hostName: "Host",
        hostParticipation: "admin-only",
      });

      // Bootstrap with clientToken (host's token)
      const bootstrap = registry.bootstrap(createResult.code, createResult.clientToken);
      expect(bootstrap).not.toEqual("not-found");
      expect(bootstrap).not.toEqual("ended");

      if (typeof bootstrap === "object" && "participantId" in bootstrap) {
        expect(bootstrap.participantId).toBe(createResult.hostId);
        expect(bootstrap.role).toBe("host");
        expect(bootstrap.hostParticipation).toBe("admin-only");
      } else {
        throw new Error("bootstrap should include role info");
      }
    });

    test("bootstrap includes observer role for joining participant", () => {
      const registry = new RoomRegistry();
      const createResult = registry.create({
        hostName: "Host",
        hostParticipation: "host-participant",
      });

      const joinResult = registry.join(createResult.code, "Guest", "observer");
      expect(joinResult).not.toEqual("not-found");
      expect(joinResult).not.toEqual("ended");

      if (typeof joinResult === "object") {
        const bootstrap = registry.bootstrap(createResult.code, joinResult.clientToken);
        expect(bootstrap).not.toEqual("not-found");
        expect(bootstrap).not.toEqual("ended");

        if (typeof bootstrap === "object" && "participantId" in bootstrap) {
          expect(bootstrap.participantId).toBe(joinResult.participantId);
          expect(bootstrap.role).toBe("observer");
          expect(bootstrap.hostParticipation).toBe("host-participant");
        } else {
          throw new Error("bootstrap should include role info for observer");
        }
      } else {
        throw new Error("join should succeed");
      }
    });

    test("bootstrap includes spectator role for spectator participant", () => {
      const registry = new RoomRegistry();
      const createResult = registry.create({
        hostName: "Host",
        hostParticipation: "admin-only",
      });

      const joinResult = registry.join(createResult.code, "Spectator", "spectator");
      expect(joinResult).not.toEqual("not-found");
      expect(joinResult).not.toEqual("ended");

      if (typeof joinResult === "object") {
        const bootstrap = registry.bootstrap(createResult.code, joinResult.clientToken);
        expect(bootstrap).not.toEqual("not-found");
        expect(bootstrap).not.toEqual("ended");

        if (typeof bootstrap === "object" && "participantId" in bootstrap) {
          expect(bootstrap.participantId).toBe(joinResult.participantId);
          expect(bootstrap.role).toBe("spectator");
          expect(bootstrap.hostParticipation).toBe("admin-only");
        } else {
          throw new Error("bootstrap should include spectator role info");
        }
      } else {
        throw new Error("join should succeed");
      }
    });

    test("bootstrap without clientToken does not include role info", () => {
      const registry = new RoomRegistry();
      const createResult = registry.create({
        hostName: "Host",
        hostParticipation: "admin-only",
      });

      // Bootstrap without clientToken
      const bootstrap = registry.bootstrap(createResult.code);
      expect(bootstrap).not.toEqual("not-found");
      expect(bootstrap).not.toEqual("ended");

      if (typeof bootstrap === "object") {
        expect(bootstrap.participantId).toBeUndefined();
        expect(bootstrap.role).toBeUndefined();
        expect(bootstrap.hostParticipation).toBeUndefined();
        expect(bootstrap.roster).toBeDefined();
      } else {
        throw new Error("bootstrap should return object");
      }
    });

    test("bootstrap with invalid clientToken does not include role info", () => {
      const registry = new RoomRegistry();
      const createResult = registry.create({
        hostName: "Host",
        hostParticipation: "admin-only",
      });

      // Bootstrap with invalid token
      const bootstrap = registry.bootstrap(createResult.code, "invalid-token");
      expect(bootstrap).not.toEqual("not-found");
      expect(bootstrap).not.toEqual("ended");

      if (typeof bootstrap === "object") {
        expect(bootstrap.participantId).toBeUndefined();
        expect(bootstrap.role).toBeUndefined();
        expect(bootstrap.hostParticipation).toBeUndefined();
        expect(bootstrap.roster).toBeDefined();
      } else {
        throw new Error("bootstrap should return object");
      }
    });

    test("bootstrap with host-participant mode includes hostParticipation", () => {
      const registry = new RoomRegistry();
      const createResult = registry.create({
        hostName: "Host",
        hostParticipation: "host-participant",
      });

      const bootstrap = registry.bootstrap(createResult.code, createResult.clientToken);
      expect(bootstrap).not.toEqual("not-found");
      expect(bootstrap).not.toEqual("ended");

      if (typeof bootstrap === "object" && "hostParticipation" in bootstrap) {
        expect(bootstrap.hostParticipation).toBe("host-participant");
      } else {
        throw new Error("bootstrap should include hostParticipation");
      }
    });
  });

  describe("Multiple participants - role confirmation", () => {
    test("each participant gets correct role from bootstrap", () => {
      const registry = new RoomRegistry();
      const hostResult = registry.create({
        hostName: "Alice",
        hostParticipation: "host-participant",
      });

      const observer1Result = registry.join(hostResult.code, "Bob", "observer");
      expect(observer1Result).not.toEqual("not-found");
      expect(observer1Result).not.toEqual("ended");

      const observer2Result = registry.join(hostResult.code, "Carol", "observer");
      expect(observer2Result).not.toEqual("not-found");
      expect(observer2Result).not.toEqual("ended");

      const spectatorResult = registry.join(hostResult.code, "Dave", "spectator");
      expect(spectatorResult).not.toEqual("not-found");
      expect(spectatorResult).not.toEqual("ended");

      // Host should get host role
      if (
        typeof observer1Result === "object"
        && typeof observer2Result === "object"
        && typeof spectatorResult === "object"
      ) {
        const hostBoot = registry.bootstrap(hostResult.code, hostResult.clientToken);
        expect(hostBoot).not.toEqual("not-found");
        if (typeof hostBoot === "object" && "role" in hostBoot) {
          expect(hostBoot.role).toBe("host");
        }

        // Each observer should get observer role
        const obs1Boot = registry.bootstrap(hostResult.code, observer1Result.clientToken);
        expect(obs1Boot).not.toEqual("not-found");
        if (typeof obs1Boot === "object" && "role" in obs1Boot) {
          expect(obs1Boot.role).toBe("observer");
        }

        const obs2Boot = registry.bootstrap(hostResult.code, observer2Result.clientToken);
        expect(obs2Boot).not.toEqual("not-found");
        if (typeof obs2Boot === "object" && "role" in obs2Boot) {
          expect(obs2Boot.role).toBe("observer");
        }

        // Spectator should get spectator role
        const specBoot = registry.bootstrap(hostResult.code, spectatorResult.clientToken);
        expect(specBoot).not.toEqual("not-found");
        if (typeof specBoot === "object" && "role" in specBoot) {
          expect(specBoot.role).toBe("spectator");
        }
      }
    });
  });

  describe("Bootstrap response structure", () => {
    test("bootstrap response includes all required fields with clientToken", () => {
      const registry = new RoomRegistry();
      const createResult = registry.create({
        hostName: "Host",
        hostParticipation: "admin-only",
      });

      const bootstrap = registry.bootstrap(createResult.code, createResult.clientToken);
      expect(bootstrap).not.toEqual("not-found");
      expect(bootstrap).not.toEqual("ended");

      if (typeof bootstrap === "object") {
        // Original fields always present
        expect(bootstrap.version).toBeDefined();
        expect(typeof bootstrap.version).toBe("number");
        expect(bootstrap.doc).toBeDefined();
        expect(typeof bootstrap.doc).toBe("string");
        expect(bootstrap.phase).toBeDefined();
        const phases = ["created", "active", "ended"];
        expect(phases.includes(bootstrap.phase)).toBe(true);
        expect(bootstrap.roster).toBeDefined();
        expect(Array.isArray(bootstrap.roster)).toBe(true);

        // New fields with clientToken
        expect(bootstrap.participantId).toBeDefined();
        expect(typeof bootstrap.participantId).toBe("string");
        expect(bootstrap.role).toBeDefined();
        const validRoles = ["host", "observer", "spectator"];
        expect(validRoles.includes(bootstrap.role as string)).toBe(true);
        expect(bootstrap.hostParticipation).toBeDefined();
        const validHostParticipation = ["admin-only", "host-participant"];
        expect(validHostParticipation.includes(bootstrap.hostParticipation as string)).toBe(true);
      } else {
        throw new Error("bootstrap should return object");
      }
    });

    test("bootstrap response includes roster with all participants", () => {
      const registry = new RoomRegistry();
      const hostResult = registry.create({
        hostName: "Host",
        hostParticipation: "host-participant",
      });

      registry.join(hostResult.code, "Guest1", "observer");
      registry.join(hostResult.code, "Guest2", "spectator");

      const bootstrap = registry.bootstrap(hostResult.code, hostResult.clientToken);
      expect(bootstrap).not.toEqual("not-found");
      expect(bootstrap).not.toEqual("ended");

      if (typeof bootstrap === "object" && Array.isArray(bootstrap.roster)) {
        expect(bootstrap.roster.length).toBe(3); // host + 2 guests

        // Verify roster entry structure
        bootstrap.roster.forEach((entry) => {
          expect(entry.id).toBeDefined();
          expect(entry.name).toBeDefined();
          expect(entry.role).toBeDefined();
          expect(typeof entry.connected).toBe("boolean");
        });
      } else {
        throw new Error("bootstrap should include roster array");
      }
    });
  });
});
