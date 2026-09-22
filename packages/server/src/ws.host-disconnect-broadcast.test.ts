/**
 * GAP-DOCUMENTATION TEST (EXPECTED TO FAIL) — Host disconnect is not
 * broadcast to other participants in real time.
 *
 * See docs/bugfixes/GAPS-duplicate-names-host-disconnect-rejoin.md (Gap 2)
 * for full root-cause analysis.
 *
 * `ws.ts`'s native `close()` handler updates `room.session` so the
 * disconnecting participant's `connected` flag flips to `false`, but only
 * calls `broadcastSessionState()` when the disconnecting participant is the
 * CURRENT DRIVER (the disconnect-grace-period path). For a plain host (or
 * any non-driving participant) disconnect, no `sessionSnapshot` is ever
 * published — other clients never learn the host left.
 *
 * THIS TEST IS EXPECTED TO FAIL. It races a `sessionSnapshot` reflecting the
 * host's `connected: false` against a bounded timeout sentinel. Per the bug,
 * the message never arrives, so the timeout sentinel wins and the assertion
 * on the message shape fails. This failure IS the documentation of the bug.
 * No production code (ws.ts) is modified or fixed here, per explicit product
 * decision — see the doc above for what the fix would look like.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createAppWithDeps } from "./app";
import { createWebSocketHandler, tryUpgrade, type SocketData } from "./ws";
import { RoomRegistry } from "./rooms";
import type { ServerMessage } from "@codayon/shared";

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

/** Resolves with the first matching message, or "timeout" if none arrives in time. */
function nextMessageOrTimeout(
  ws: WebSocket,
  match: (m: ServerMessage) => boolean,
  timeoutMs: number,
): Promise<ServerMessage | "timeout"> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.removeEventListener("message", handler);
      resolve("timeout");
    }, timeoutMs);

    function handler(ev: MessageEvent) {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      if (!match(msg) || settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeEventListener("message", handler);
      resolve(msg);
    }

    ws.addEventListener("message", handler);
  });
}

async function createRoom() {
  const res = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostName: "Host", hostParticipation: "admin-only" }),
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

describe("GAP: host disconnect is not broadcast in real time (ws.ts close handler)", () => {
  test("observer should receive a sessionSnapshot reflecting host connected:false after host disconnects", async () => {
    const room = await createRoom();
    const guest = await joinRoom(room.code);

    const host = await connect(room.code, room.clientToken);
    const observer = await connect(room.code, guest.clientToken);

    // Drain the initial roleAssigned messages both sockets receive on open,
    // so they don't get mistaken for the snapshot we're waiting for.
    await nextMessageOrTimeout(host, (m) => m.type === "roleAssigned", 500);
    await nextMessageOrTimeout(observer, (m) => m.type === "roleAssigned", 500);

    // Race a sessionSnapshot reflecting the host's disconnect against a
    // bounded timeout sentinel. Per the bug, ws.ts's close() handler never
    // calls broadcastSessionState() for a non-driver disconnect, so the
    // "timeout" branch is expected to win.
    const snapshotOrTimeout = nextMessageOrTimeout(
      observer,
      (m) => m.channel === "control" && m.type === "sessionSnapshot",
      1500,
    );

    // Host disconnects (not currently driving — no active turn exists yet).
    host.close();

    const result = await snapshotOrTimeout;

    // EXPECTED TO FAIL: `result` will be the string "timeout", not a
    // sessionSnapshot message, because the server never broadcasts one for
    // a plain host disconnect. This assertion documents the gap.
    expect(result).not.toBe("timeout");
    if (result === "timeout") {
      observer.close();
      return;
    }

    const snapshot = result as Extract<ServerMessage, { type: "sessionSnapshot" }>;
    const hostEntry = snapshot.roster.find((p) => p.role === "host");
    expect(hostEntry?.connected).toBe(false);

    observer.close();
  }, 5000);
});
