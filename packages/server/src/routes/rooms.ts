/**
 * HTTP room-lifecycle routes (REQ-001/002/003), mounted under `/api`.
 *
 *   POST /api/rooms                    -> create a room (host)
 *   POST /api/rooms/:code/join         -> join as participant | spectator
 *   GET  /api/rooms/:code/bootstrap    -> current doc + roster snapshot
 *
 * The registry is injected so tests and the server share one instance and can
 * substitute deterministic generators.
 */

import { Hono } from "hono";
import type { HostParticipation, JoinableRole } from "@codayon/shared";
import type { RoomRegistry } from "../rooms";

function isHostParticipation(v: unknown): v is HostParticipation {
  return v === "admin-only" || v === "host-participant";
}

function isJoinRole(v: unknown): v is JoinableRole {
  return v === "observer" || v === "spectator";
}

function cleanName(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const trimmed = v.trim().slice(0, 64);
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Builds the room API sub-app bound to a registry. */
export function roomRoutes(registry: RoomRegistry): Hono {
  const api = new Hono();

  // REQ-001 — create a room and become its host.
  api.post("/rooms", async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      // Empty/invalid body is allowed; we fall back to defaults below.
      body = {};
    }

    const hostParticipation = isHostParticipation(body.hostParticipation)
      ? body.hostParticipation
      : "admin-only";
    const hostName = cleanName(body.hostName, "Host");

    const result = registry.create({ hostName, hostParticipation });

    // The host token + client token are secrets returned ONLY to the creator
    // (REQ-001.1); they are never broadcast to other participants.
    return c.json(
      {
        code: result.code,
        joinUrl: `/room/${result.code}`,
        hostId: result.hostId,
        hostToken: result.hostToken,
        clientToken: result.clientToken,
        hostParticipation,
      },
      201,
    );
  });

  // REQ-002 — join a room via code as participant (observer) or spectator.
  api.post("/rooms/:code/join", async (c) => {
    const code = c.req.param("code");
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    if (!isJoinRole(body.role)) {
      return c.json(
        { error: "invalid-role", message: "role must be 'observer' or 'spectator'" },
        400,
      );
    }
    const name = cleanName(body.name, body.role === "spectator" ? "Spectator" : "Guest");

    const result = registry.join(code, name, body.role);
    if (result === "not-found" || result === "ended") {
      // REQ-002.2 / REQ-004.3 — do not reveal which; the room is unavailable.
      return c.json(
        { error: "room-unavailable", message: "That room is unavailable." },
        404,
      );
    }

    return c.json(
      {
        code,
        participantId: result.participantId,
        role: result.role,
        clientToken: result.clientToken,
      },
      200,
    );
  });

  // REQ-002.4 — bootstrap the current authoritative document + roster.
  api.get("/rooms/:code/bootstrap", (c) => {
    const code = c.req.param("code");
    const clientToken = c.req.query("clientToken") ?? undefined;
    const result = registry.bootstrap(code, clientToken);
    if (result === "not-found" || result === "ended") {
      return c.json(
        { error: "room-unavailable", message: "That room is unavailable." },
        404,
      );
    }
    return c.json(result, 200);
  });

  return api;
}
