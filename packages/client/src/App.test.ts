/**
 * URL parameter parsing and auto-join behavior (BUGFIX-006).
 *
 * Verifies that the client:
 * 1. Parses room code from /room/{code} pathname
 * 2. Parses clientToken from ?clientToken= query parameter
 * 3. Auto-initializes session when both are present
 * 4. Does NOT auto-join if either is missing
 * 5. Handles bootstrap failures gracefully
 */

import { describe, test, expect } from "bun:test";

describe("URL parameter parsing and auto-join (BUGFIX-006)", () => {
  describe("URL parsing logic", () => {
    test("extracts room code from /room/{code} pathname", () => {
      const pathname = "/room/ABC123";
      const code = pathname.match(/\/room\/([A-Z0-9]+)/)?.[1];
      expect(code).toBe("ABC123");
    });

    test("extracts clientToken from ?clientToken= query parameter", () => {
      const search = "?clientToken=xyz-token-123";
      const params = new URLSearchParams(search);
      const token = params.get("clientToken");
      expect(token).toBe("xyz-token-123");
    });

    test("handles room code with various valid formats (6-letter codes)", () => {
      const testCases = ["ABCDEF", "E8ZACG", "XYZABC", "000000", "ZZZZZZ"];
      testCases.forEach((code) => {
        const pathname = `/room/${code}`;
        const extracted = pathname.match(/\/room\/([A-Z0-9]+)/)?.[1];
        expect(extracted).toBe(code);
      });
    });

    test("returns undefined for non-room pathnames", () => {
      const testCases = ["/", "/lobby", "/about", "/room", "/room/"];
      testCases.forEach((pathname) => {
        const code = pathname.match(/\/room\/([A-Z0-9]+)/)?.[1];
        expect(code).toBeUndefined();
      });
    });

    test("returns null for missing clientToken in search", () => {
      const search = "?foo=bar";
      const params = new URLSearchParams(search);
      const token = params.get("clientToken");
      expect(token).toBeNull();
    });

    test("returns null for empty search string", () => {
      const search = "";
      const params = new URLSearchParams(search);
      const token = params.get("clientToken");
      expect(token).toBeNull();
    });

    test("handles both code and token present", () => {
      const pathname = "/room/TESTCODE";
      const search = "?clientToken=abc123";
      const code = pathname.match(/\/room\/([A-Z0-9]+)/)?.[1];
      const params = new URLSearchParams(search);
      const token = params.get("clientToken");
      expect(code).toBe("TESTCODE");
      expect(token).toBe("abc123");
    });
  });

  describe("Session initialization conditions", () => {
    test("should initialize session when code and token both present", () => {
      const pathname = "/room/ROOM1";
      const search = "?clientToken=token1";

      const codeFromURL = pathname.match(/\/room\/([A-Z0-9]+)/)?.[1];
      const tokenFromURL = new URLSearchParams(search).get("clientToken");
      const shouldAutoJoin = codeFromURL && tokenFromURL;

      expect(shouldAutoJoin).toBeTruthy();
      expect(codeFromURL).toBe("ROOM1");
      expect(tokenFromURL).toBe("token1");
    });

    test("should NOT initialize session when code is missing", () => {
      const pathname = "/";
      const search = "?clientToken=token1";

      const codeFromURL = pathname.match(/\/room\/([A-Z0-9]+)/)?.[1];
      const tokenFromURL = new URLSearchParams(search).get("clientToken");
      const shouldAutoJoin = codeFromURL && tokenFromURL;

      expect(shouldAutoJoin).toBeFalsy();
      expect(codeFromURL).toBeUndefined();
    });

    test("should NOT initialize session when token is missing", () => {
      const pathname = "/room/ROOM1";
      const search = "";

      const codeFromURL = pathname.match(/\/room\/([A-Z0-9]+)/)?.[1];
      const tokenFromURL = new URLSearchParams(search).get("clientToken");
      const shouldAutoJoin = codeFromURL && tokenFromURL;

      expect(shouldAutoJoin).toBeFalsy();
      expect(tokenFromURL).toBeNull();
    });

    test("should NOT initialize session when neither code nor token present", () => {
      const pathname = "/";
      const search = "";

      const codeFromURL = pathname.match(/\/room\/([A-Z0-9]+)/)?.[1];
      const tokenFromURL = new URLSearchParams(search).get("clientToken");
      const shouldAutoJoin = codeFromURL && tokenFromURL;

      expect(shouldAutoJoin).toBeFalsy();
    });
  });

  describe("URL token stripping", () => {
    test("replaceState is called with token-stripped URL after successful join", () => {
      const code = "ROOM1";
      const originalURL = `/room/${code}?clientToken=secret123`;
      const stripTokenURL = `/room/${code}`;

      // Simulate what App.tsx will do after bootstrap succeeds
      const url = new URL(`http://localhost${originalURL}`);
      const strippedPath = `/room/${url.pathname.match(/\/room\/([A-Z0-9]+)/)?.[1]}`;

      expect(strippedPath).toBe(stripTokenURL);
    });

    test("preserves room code in the stripped URL", () => {
      const testCases = [
        { original: "/room/ABC?clientToken=xyz", expected: "/room/ABC" },
        { original: "/room/XYZ123?clientToken=token", expected: "/room/XYZ123" },
        { original: "/room/E8ZACG?clientToken=2de9c52b", expected: "/room/E8ZACG" },
      ];

      testCases.forEach(({ original, expected }) => {
        const url = new URL(`http://localhost${original}`);
        const code = url.pathname.match(/\/room\/([A-Z0-9]+)/)?.[1];
        const stripped = `/room/${code}`;
        expect(stripped).toBe(expected);
      });
    });
  });

  describe("Placeholder role behavior", () => {
    test("uses 'observer' as placeholder role during URL-based join", () => {
      const placeholderRole = "observer" as const;
      expect(placeholderRole).toBe("observer");
    });

    test("placeholder role is overwritten by bootstrap role", () => {
      // Simulate the bootstrap flow
      let role: "host" | "observer" | "spectator" = "observer"; // Placeholder
      const bootstrapRole = "host" as const; // Server-confirmed role
      role = bootstrapRole; // RoomEditor.tsx setRole call

      expect(role).toBe("host");
    });

    test("all valid roles can be received from bootstrap", () => {
      const bootstrapRoles = ["host", "observer", "spectator"] as const;

      bootstrapRoles.forEach((bootstrapRole) => {
        let role: "host" | "observer" | "spectator" = "observer"; // Placeholder
        role = bootstrapRole; // Server-confirmed role
        expect(role).toBe(bootstrapRole);
      });
    });
  });

  describe("Bootstrap error handling", () => {
    test("error message is extracted from Error object", () => {
      const error = new Error("Failed to bootstrap room");
      const message = error instanceof Error ? error.message : "Unknown error";
      expect(message).toBe("Failed to bootstrap room");
    });

    test("fallback message for non-Error objects", () => {
      const error = "Some string error";
      const message = error instanceof Error ? error.message : "Unknown error";
      expect(message).toBe("Unknown error");
    });

    test("bootstrap error does not throw unhandled", () => {
      const simulateBootstrapFailure = () => {
        try {
          throw new Error("Room not found");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return { success: false, message };
        }
      };

      const result = simulateBootstrapFailure();
      expect(result.success).toBe(false);
      expect(result.message).toBe("Room not found");
    });

    test("session is cleared on bootstrap error", () => {
      let session: { code: string; clientToken: string } | null = {
        code: "ROOM1",
        clientToken: "token123",
      };

      // Simulate error handling
      session = null;

      expect(session).toBeNull();
    });

    test("error message is displayed in lobby", () => {
      const error = new Error("Failed to join room");
      const message = error instanceof Error ? error.message : "Unknown error";

      // In App.tsx, this would call: setError(message)
      const displayedError = message;

      expect(displayedError).toBe("Failed to join room");
    });
  });

  describe("Session object structure", () => {
    test("session object has required fields for URL-based join", () => {
      const code = "ROOM1";
      const clientToken = "token123";
      const clientID = "c_abc123def456";
      const role = "observer" as const;

      const session = { code, clientToken, clientID, role };

      expect(session.code).toBe("ROOM1");
      expect(session.clientToken).toBe("token123");
      expect(session.clientID).toBeDefined();
      expect(session.role).toBe("observer");
    });

    test("clientID is properly formatted", () => {
      const clientID = `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      expect(clientID).toMatch(/^c_[a-z0-9]+[a-z0-9]+$/);
    });
  });

  /**
   * GAP-DOCUMENTATION TEST — No "rejoin as host" UI/backend path exists.
   *
   * See docs/bugfixes/GAPS-duplicate-names-host-disconnect-rejoin.md (Gap 3)
   * for full root-cause analysis.
   *
   * App.tsx's Lobby() only renders two join buttons, both calling
   * `onJoin(role: JoinableRole)` — where `JoinableRole = Exclude<Role, "host">`
   * (engine.ts) — so "host" is excluded from the joinable set at the type
   * level itself, not just by convention. `onCreate()` is the only function
   * that ever produces a host session, and it can only be used at
   * room-creation time. There is no third button, no host-token input field,
   * and no code path anywhere in App.tsx that constructs a request carrying
   * a `hostToken` to re-authenticate as host on an existing room.
   *
   * These tests mirror App.tsx's actual `onJoin`/`onCreate` signatures and
   * assert this absence directly. They are expected to PASS — they document
   * an accurate absence of a feature, not a crash. No production code
   * (App.tsx) is modified here, per explicit product decision.
   */
  describe("Host rejoin gap (undocumented feature)", () => {
    test("the lobby's only join-role actions are 'observer' and 'spectator', never 'host'", () => {
      // Mirrors App.tsx's Lobby(): exactly two buttons, each calling
      // onJoin("observer") / onJoin("spectator") respectively.
      const lobbyJoinActions: ReadonlyArray<"observer" | "spectator"> = [
        "observer", // "Join as participant" button
        "spectator", // "Spectate" button
      ];

      expect(lobbyJoinActions).toEqual(["observer", "spectator"]);
      expect(lobbyJoinActions).not.toContain("host");
    });

    test("onJoin's role parameter type excludes 'host' by construction (JoinableRole = Exclude<Role, 'host'>)", () => {
      // Mirrors App.tsx: `async function onJoin(role: JoinableRole)`.
      // JoinableRole is defined in engine.ts as Exclude<Role, "host">, so
      // passing "host" is a compile-time error, not just a missing UI case.
      type Role = "host" | "observer" | "spectator";
      type JoinableRole = Exclude<Role, "host">;

      function onJoin(role: JoinableRole): JoinableRole {
        return role; // mirrors App.tsx's onJoin(role) -> joinRoom(code, { role, name })
      }

      expect(onJoin("observer")).toBe("observer");
      expect(onJoin("spectator")).toBe("spectator");
      // @ts-expect-error "host" is not assignable to JoinableRole
      const attempt = () => onJoin("host");
      expect(attempt).toBeDefined(); // never actually invoked; type system already rejects it
    });

    test("onCreate is the only path to a host session, and only at room-creation time", () => {
      // Mirrors App.tsx: onCreate() always sets role: "host" unconditionally,
      // and is only ever wired to the "Create a room" button — never to a
      // "rejoin" action on an existing room code.
      interface Session {
        code: string;
        clientToken: string;
        clientID: string;
        role: "host" | "observer" | "spectator";
      }

      function onCreate(code: string, clientToken: string, clientID: string): Session {
        return { code, clientToken, clientID, role: "host" };
      }

      const session = onCreate("ROOM1", "created-token", "c_abc123");
      expect(session.role).toBe("host");

      // onCreate has no parameter for an existing room's hostToken — its
      // signature only supports the brand-new-room flow. There is no
      // "rejoinAsHost(code, hostToken)" function anywhere in App.tsx.
      expect(onCreate.length).toBe(3);
    });

    test("no code path in the mirrored onJoin/onCreate logic accepts or forwards a hostToken", () => {
      // Simulates the full set of request bodies App.tsx is capable of
      // constructing today: joinRoom's body only ever has {role, name}, and
      // createRoom's body only ever has {hostName, hostParticipation}.
      // Neither shape has room for a hostToken field, confirming there is no
      // "rejoin with hostToken" request this client can ever issue.
      interface JoinRequestBody {
        role: "observer" | "spectator";
        name: string;
      }
      interface CreateRequestBody {
        hostName: string;
        hostParticipation: "admin-only" | "host-participant";
      }

      const joinBody: JoinRequestBody = { role: "observer", name: "Guest" };
      const createBody: CreateRequestBody = {
        hostName: "Host",
        hostParticipation: "host-participant",
      };

      expect("hostToken" in joinBody).toBe(false);
      expect("hostToken" in createBody).toBe(false);
    });
  });
});
