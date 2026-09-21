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
 * Doc channel this task:
 *  - `getDocument`  -> `document` (version + text) for a (re)joining peer
 *  - `pullUpdates`  -> `updates` accepted since the peer's version
 *  - `pushUpdates`  -> apply to the authority, then broadcast accepted `updates`
 *                      to the whole room via pub/sub
 *
 * Token/role enforcement on pushes is deferred to Task 6; for now any connected
 * participant may push.
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
      }
      // presence + control channels arrive in later tasks.
    },

    close(ws: ServerWebSocket<SocketData>) {
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
