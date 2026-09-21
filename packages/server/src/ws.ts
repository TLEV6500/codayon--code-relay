/**
 * WebSocket relay layer (REQ-016/017; NFR-001).
 *
 * Per the approved design, the WS path stays on Bun's NATIVE handler (not
 * Hono's `upgradeWebSocket` helper) so we keep Bun's native pub/sub
 * (`ws.subscribe(code)` / `server.publish(code, ...)`) and the raw `Server` for
 * efficient room broadcast.
 *
 * Connection URL: `ws://host/ws?code=<ROOM>&clientToken=<TOKEN>`. The upgrade is
 * authenticated by resolving `clientToken` to a participant in the room; an
 * unknown room or token is refused before the socket opens.
 *
 * Doc channel:
 *  - `getDocument`  -> `document` (version + text) for a (re)joining peer
 *  - `pullUpdates`  -> `updates` accepted since the peer's version
 *  - `pushUpdates`  -> apply to the authority, then broadcast accepted `updates`
 *                      to the whole room via pub/sub (token + spectator
 *                      enforcement at REQ-012/013/014)
 *
 * Presence channel (transient awareness, REQ-018):
 *  - `presence`     -> enrich with participant id + name and relay to the rest
 *                      of the room (sender excluded) as `presence`
 *  - on disconnect  -> broadcast `presenceGone` so peers purge the indicator
 *
 * Token/role enforcement: rejects non-token-holders and spectators (Task 6).
 */

import type { Server, ServerWebSocket } from "bun";
import {
  applyEvent,
  type ClientMessage,
  type ParticipantId,
  type ServerMessage,
} from "@codayon/shared";
import type { RoomRegistry } from "./rooms";

/** Contextual data attached to each socket at upgrade time. */
export interface SocketData {
  readonly code: string;
  readonly participantId: ParticipantId;
}

/** The pub/sub topic for a room's broadcast channel. */
export function roomTopic(code: string): string {
  return `room:${code}`;
}

function send(ws: ServerWebSocket<SocketData>, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

/**
 * Attempts to upgrade an incoming request to a WebSocket.
 *
 * Returns:
 *  - `"not-ws"`      when the path is not the WS endpoint (fall through to HTTP)
 *  - `"upgraded"`    when the socket was upgraded (return no Response)
 *  - a `Response`    when the request targeted `/ws` but was refused
 */
export function tryUpgrade(
  req: Request,
  server: Server<SocketData>,
  registry: RoomRegistry,
): "not-ws" | "upgraded" | Response {
  const url = new URL(req.url);
  if (url.pathname !== "/ws") return "not-ws";

  const code = url.searchParams.get("code") ?? "";
  const clientToken = url.searchParams.get("clientToken") ?? "";
  const participantId = registry.resolveClient(code, clientToken);

  // Reject unknown room/token before opening the socket (REQ-002.2 analog).
  if (!participantId) {
    return new Response("room unavailable", { status: 404 });
  }

  const data: SocketData = { code, participantId };
  if (server.upgrade(req, { data })) return "upgraded";
  return new Response("expected a websocket upgrade", { status: 426 });
}

/** Builds the native Bun websocket handler bound to the registry + server. */
export function createWebSocketHandler(
  registry: RoomRegistry,
  getServer: () => Server<SocketData> | undefined,
) {
  return {
    open(ws: ServerWebSocket<SocketData>) {
      ws.subscribe(roomTopic(ws.data.code));
      // Mark the participant connected in the session model.
      const room = registry.get(ws.data.code);
      if (room) {
        room.session = applyConnection(room, ws.data.participantId, true);
      }
    },

    message(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
      const room = registry.get(ws.data.code);
      if (!room) return;

      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        return;
      }

      if (msg.channel === "doc") {
        handleDocMessage(ws, room.code, registry, getServer(), msg);
      } else if (msg.channel === "presence") {
        handlePresenceMessage(ws, registry, msg);
      }
      // control channel arrives in later tasks.
    },

    close(ws: ServerWebSocket<SocketData>) {
      // Purge this user's presence for everyone else (REQ-018.4). Publish before
      // unsubscribing so the socket is still a member of the topic.
      const gone: ServerMessage = {
        channel: "presence",
        type: "presenceGone",
        participantId: ws.data.participantId,
      };
      ws.publish(roomTopic(ws.data.code), JSON.stringify(gone));
      ws.unsubscribe(roomTopic(ws.data.code));
      const room = registry.get(ws.data.code);
      if (room) {
        room.session = applyConnection(room, ws.data.participantId, false);
      }
    },
  };
}

function handleDocMessage(
  ws: ServerWebSocket<SocketData>,
  code: string,
  registry: RoomRegistry,
  server: Server<SocketData> | undefined,
  msg: Extract<ClientMessage, { channel: "doc" }>,
): void {
  const room = registry.get(code);
  if (!room) return;

  switch (msg.type) {
    case "getDocument": {
      const snap = room.doc.getDocument();
      send(ws, {
        channel: "doc",
        type: "document",
        version: snap.version,
        doc: snap.doc,
      });
      return;
    }

    case "pullUpdates": {
      const updates = room.doc.pullUpdates(msg.version);
      if (updates.length) {
        send(ws, { channel: "doc", type: "updates", updates });
      }
      return;
    }

    case "pushUpdates": {
      // Also reject spectators (REQ-006.2, REQ-014): they can never push.
      const participant = room.session.participants.get(ws.data.participantId);
      if (participant?.role === "spectator") {
        send(ws, {
          channel: "doc",
          type: "pushRejected",
          reason: "spectator",
        });
        return;
      }

      // REQ-012, REQ-013/014: Only the token holder can push (NFR-005.1).
      // Token enforcement only applies when a turn is active (editTokenHolder is set).
      if (room.session.editTokenHolder !== null) {
        if (room.session.editTokenHolder !== ws.data.participantId) {
          send(ws, {
            channel: "doc",
            type: "pushRejected",
            reason: "not-token-holder",
          });
          return;
        }
      }

      const accepted = room.doc.pushUpdates(msg.version, msg.updates);
      if (accepted === null) {
        send(ws, {
          channel: "doc",
          type: "pushRejected",
          reason: "not-token-holder",
        });
        return;
      }
      if (accepted.length && server) {
        // Broadcast to the whole room (including sender) so every peer applies
        // the authority's ordering (REQ-016.1/3, REQ-017).
        const payload: ServerMessage = {
          channel: "doc",
          type: "updates",
          updates: accepted,
        };
        server.publish(roomTopic(code), JSON.stringify(payload));
      }
      return;
    }

    default:
      return;
  }
}

/**
 * Relays a client's presence (cursor/selection) to the rest of the room
 * (REQ-018.1). The payload is enriched with the sender's participant id + name
 * so peers can label the remote cursor; `ws.publish` excludes the sender, so a
 * client never receives an echo of its own presence.
 *
 * Presence is transient awareness data kept separate from the authoritative
 * document (REQ-018.3): it is only relayed, never stored.
 */
function handlePresenceMessage(
  ws: ServerWebSocket<SocketData>,
  registry: RoomRegistry,
  msg: Extract<ClientMessage, { channel: "presence" }>,
): void {
  const room = registry.get(ws.data.code);
  if (!room) return;

  const participant = room.session.participants.get(ws.data.participantId);
  const name = participant?.name ?? "Guest";

  const relayed: ServerMessage = {
    channel: "presence",
    type: "presence",
    participantId: ws.data.participantId,
    name,
    anchor: msg.anchor,
    head: msg.head,
  };
  // Socket-level publish excludes the sender (REQ-018.1 "all OTHER users").
  ws.publish(roomTopic(ws.data.code), JSON.stringify(relayed));
}

/** Applies a connection-status change to the room's session (via the engine). */
function applyConnection(
  room: NonNullable<ReturnType<RoomRegistry["get"]>>,
  id: ParticipantId,
  connected: boolean,
) {
  return applyEvent(room.session, {
    type: "connectionChanged",
    id,
    connected,
  });
}
