import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { ChangeSet } from "@codemirror/state";
import { createAppWithDeps } from "./app";
import { createWebSocketHandler, tryUpgrade, type SocketData } from "./ws";
import { RoomRegistry } from "./rooms";
import type { ClientMessage, ServerMessage, WireUpdate } from "@codayon/shared";

let server: Server<SocketData>;
let baseUrl: string;
let wsBase: string;
let registry: RoomRegistry;

beforeAll(() => {
  registry = new RoomRegistry();
  const { app } = createAppWithDeps({ registry });
  let srv: Server<SocketData> | undefined;
  const websocket = createWebSocketHandler(registry, () => srv);
  srv = Bun.serve({
    port: 0,
    fetch(req, s) {
      const up = tryUpgrade(req, s, registry);
      if (up === "upgraded") return undefined;
      if (up instanceof Response) return up;
      return app.fetch(req, { server: s });
    },
    websocket,
  });
  server = srv;
  baseUrl = `http://localhost:${server.port}`;
  wsBase = `ws://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

function connect(code: string, clientToken: string): Promise<WebSocket> {
  const ws = new WebSocket(`${wsBase}/ws?code=${code}&clientToken=${clientToken}`);
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
}

function nextMessage(ws: WebSocket, match: (m: ServerMessage) => boolean): Promise<ServerMessage> {
  return new Promise((resolve) => {
    const handler = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      if (match(msg)) {
        ws.removeEventListener("message", handler);
        resolve(msg);
      }
    };
    ws.addEventListener("message", handler);
  });
}

function sendMsg(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

async function createRoom() {
  const res = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostName: "Host", hostParticipation: "host-participant" }),
  });
  return (await res.json()) as { code: string; clientToken: string };
}

async function joinRoom(code: string) {
  const res = await fetch(`${baseUrl}/api/rooms/${code}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "observer", name: "Ann" }),
  });
  return (await res.json()) as { clientToken: string };
}

function insertUpdate(clientID: string, at: number, text: string, len: number): WireUpdate {
  return {
    clientID,
    changes: ChangeSet.of({ from: at, to: at, insert: text }, len).toJSON(),
  };
}

describe("WebSocket relay (REQ-016/017)", () => {
  test("rejects a connection with an unknown token", async () => {
    const ws = new WebSocket(`${wsBase}/ws?code=NOPE&clientToken=bad`);
    const closedOrError = await new Promise<string>((resolve) => {
      ws.addEventListener("close", () => resolve("closed"), { once: true });
      ws.addEventListener("error", () => resolve("error"), { once: true });
    });
    expect(["closed", "error"]).toContain(closedOrError);
  });

  test("getDocument returns the current snapshot", async () => {
    const room = await createRoom();
    const host = await connect(room.code, room.clientToken);
    const docP = nextMessage(host, (m) => m.channel === "doc" && m.type === "document");
    sendMsg(host, { channel: "doc", type: "getDocument" });
    const doc = (await docP) as Extract<ServerMessage, { type: "document" }>;
    expect(doc.version).toBe(0);
    expect(doc.doc).toBe("");
    host.close();
  });

  test("a push is broadcast to another peer and both converge", async () => {
    const room = await createRoom();
    const guest = await joinRoom(room.code);

    const host = await connect(room.code, room.clientToken);
    const peer = await connect(room.code, guest.clientToken);

    // Peer waits for the broadcast of the host's edit.
    const peerUpdateP = nextMessage(
      peer,
      (m) => m.channel === "doc" && m.type === "updates",
    );

    // Host pushes an insert at version 0.
    sendMsg(host, {
      channel: "doc",
      type: "pushUpdates",
      version: 0,
      updates: [insertUpdate("host-client", 0, "hello", 0)],
    });

    const update = (await peerUpdateP) as Extract<ServerMessage, { type: "updates" }>;
    expect(update.updates.length).toBe(1);

    // The authority converged.
    const boot = await fetch(`${baseUrl}/api/rooms/${room.code}/bootstrap`).then(
      (r) => r.json() as Promise<{ version: number; doc: string }>,
    );
    expect(boot.version).toBe(1);
    expect(boot.doc).toBe("hello");

    host.close();
    peer.close();
  });
});
