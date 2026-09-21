/**
 * Typed WebSocket transport for the client.
 *
 * Wraps a single `WebSocket` to the relay (`/ws?code=&clientToken=`) and exposes
 * typed send + subscription for {@link ServerMessage}s. The relay broadcasts
 * accepted document updates proactively (Bun pub/sub), so the client listens for
 * `updates` rather than long-polling.
 */

import type { ClientMessage, ServerMessage } from "@codayon/shared";

export type ServerMessageHandler = (msg: ServerMessage) => void;

export interface RelayConnection {
  send(msg: ClientMessage): void;
  onMessage(handler: ServerMessageHandler): () => void;
  close(): void;
  readonly socket: WebSocket;
}

export interface ConnectOptions {
  readonly code: string;
  readonly clientToken: string;
  /** Override for tests / non-proxy setups. Defaults to same-origin `/ws`. */
  readonly baseUrl?: string;
}

function wsUrl(opts: ConnectOptions): string {
  if (opts.baseUrl) {
    const u = new URL(opts.baseUrl);
    u.searchParams.set("code", opts.code);
    u.searchParams.set("clientToken", opts.clientToken);
    return u.toString();
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const u = new URL(`${proto}//${location.host}/ws`);
  u.searchParams.set("code", opts.code);
  u.searchParams.set("clientToken", opts.clientToken);
  return u.toString();
}

/** Opens a relay connection and resolves once the socket is open. */
export function connectRelay(opts: ConnectOptions): Promise<RelayConnection> {
  const socket = new WebSocket(wsUrl(opts));
  const handlers = new Set<ServerMessageHandler>();

  socket.addEventListener("message", (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      return;
    }
    for (const h of handlers) h(msg);
  });

  const connection: RelayConnection = {
    socket,
    send(msg) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      handlers.clear();
      socket.close();
    },
  };

  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(connection), { once: true });
    socket.addEventListener("error", () => reject(new Error("ws connect failed")), {
      once: true,
    });
  });
}
