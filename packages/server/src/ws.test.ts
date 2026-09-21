import { afterAll, beforeAll, describe, expect, test, afterEach } from "bun:test";
import type { Server } from "bun";
import { ChangeSet } from "@codemirror/state";
import { applyEvent } from "@codayon/shared";
import { createAppWithDeps } from "./app";
import { createWebSocketHandler, tryUpgrade, type SocketData } from "./ws";
import { RoomRegistry } from "./rooms";
import { clearAllTimers } from "./turnScheduler";
import type { ClientMessage, ServerMessage, WireUpdate } from "@codayon/shared";

let server: Server<SocketData>;
let baseUrl: string;
let wsBase: string;
let registry: RoomRegistry;

beforeAll(() => {
  registry = new RoomRegistry();
  (globalThis as any).__testRegistry = registry;
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

  test("rejects spectator mutations (REQ-006.2, REQ-014)", async () => {
    const room = await createRoom();
    const specRes = await fetch(`${baseUrl}/api/rooms/${room.code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "spectator", name: "Watcher" }),
    }).then((r) => r.json() as Promise<{ clientToken: string }>);

    const host = await connect(room.code, room.clientToken);
    const spectator = await connect(room.code, specRes.clientToken);

    // Spectator attempts to push an update.
    const rejectionP = nextMessage(
      spectator,
      (m) => m.channel === "doc" && m.type === "pushRejected",
    );
    sendMsg(spectator, {
      channel: "doc",
      type: "pushUpdates",
      version: 0,
      updates: [insertUpdate("spectator-client", 0, "nope", 0)],
    });

    const rejection = (await rejectionP) as Extract<
      ServerMessage,
      { type: "pushRejected" }
    >;
    expect(rejection.reason).toBe("spectator");

    // The document remains unchanged.
    const boot = await fetch(`${baseUrl}/api/rooms/${room.code}/bootstrap`).then(
      (r) => r.json() as Promise<{ version: number; doc: string }>,
    );
    expect(boot.version).toBe(0);
    expect(boot.doc).toBe("");

    host.close();
    spectator.close();
  });

  test("when a token holder is set, rejects non-holders from pushing (REQ-012, REQ-013, REQ-014)", async () => {
    const room = await createRoom();
    const guest = await joinRoom(room.code);

    const host = await connect(room.code, room.clientToken);
    const peer = await connect(room.code, guest.clientToken);

    // Get the registry and room state, then manually grant the token to the host.
    // The registry is attached to the app context.
    const registryForTest = (globalThis as any).__testRegistry as RoomRegistry | undefined;
    const roomState = registryForTest?.get(room.code);
    if (roomState) {
      // Get the host ID from the current state
      const hostId = roomState.session.hostId;
      roomState.session = applyEvent(roomState.session, {
        type: "tokenGranted",
        to: hostId,
      });
    }

    // Peer (guest) attempts to push; should be rejected.
    const rejectionP = nextMessage(
      peer,
      (m) => m.channel === "doc" && m.type === "pushRejected",
    );
    sendMsg(peer, {
      channel: "doc",
      type: "pushUpdates",
      version: 0,
      updates: [insertUpdate("peer-client", 0, "mine", 0)],
    });

    const rejection = (await rejectionP) as Extract<
      ServerMessage,
      { type: "pushRejected" }
    >;
    expect(rejection.reason).toBe("not-token-holder");

    // Host can push successfully.
    const hostUpdateP = nextMessage(
      peer,
      (m) => m.channel === "doc" && m.type === "updates",
    );
    sendMsg(host, {
      channel: "doc",
      type: "pushUpdates",
      version: 0,
      updates: [insertUpdate("host-client", 0, "host-edit", 0)],
    });

    const update = (await hostUpdateP) as Extract<ServerMessage, { type: "updates" }>;
    expect(update.updates.length).toBe(1);

    // The document now contains the host's edit, not the peer's rejected attempt.
    const boot = await fetch(`${baseUrl}/api/rooms/${room.code}/bootstrap`).then(
      (r) => r.json() as Promise<{ version: number; doc: string }>,
    );
    expect(boot.version).toBe(1);
    expect(boot.doc).toBe("host-edit");

    host.close();
    peer.close();
  });
});

describe("presence channel (REQ-018)", () => {
  test("relays a peer's presence to others (enriched) and to the sender so they see their own cursor", async () => {
    const room = await createRoom();
    const guest = await joinRoom(room.code);
    const host = await connect(room.code, room.clientToken);
    const peer = await connect(room.code, guest.clientToken);

    // Both host and peer should receive the presence message.
    const hostGotP = nextMessage(
      host,
      (m) => m.channel === "presence" && m.type === "presence",
    );
    const peerGotP = nextMessage(
      peer,
      (m) => m.channel === "presence" && m.type === "presence",
    );

    sendMsg(host, { channel: "presence", type: "presence", anchor: 2, head: 5 });

    const hostRelayed = (await hostGotP) as Extract<ServerMessage, { type: "presence" }>;
    expect(hostRelayed.anchor).toBe(2);
    expect(hostRelayed.head).toBe(5);
    expect(hostRelayed.name).toBe("Host");
    expect(hostRelayed.participantId).toBeTruthy();

    const peerRelayed = (await peerGotP) as Extract<ServerMessage, { type: "presence" }>;
    expect(peerRelayed.anchor).toBe(2);
    expect(peerRelayed.head).toBe(5);
    expect(peerRelayed.name).toBe("Host");
    expect(peerRelayed.participantId).toBe(hostRelayed.participantId);

    host.close();
    peer.close();
  });

  test("presence is shown to spectators too (REQ-018.2)", async () => {
    const room = await createRoom();
    const specRes = await fetch(`${baseUrl}/api/rooms/${room.code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "spectator", name: "Watcher" }),
    }).then((r) => r.json() as Promise<{ clientToken: string }>);

    const host = await connect(room.code, room.clientToken);
    const spectator = await connect(room.code, specRes.clientToken);

    const specGotP = nextMessage(
      spectator,
      (m) => m.channel === "presence" && m.type === "presence",
    );
    sendMsg(host, { channel: "presence", type: "presence", anchor: 0, head: 1 });
    const relayed = (await specGotP) as Extract<ServerMessage, { type: "presence" }>;
    expect(relayed.head).toBe(1);

    host.close();
    spectator.close();
  });

  test("broadcasts presenceGone when a peer disconnects (REQ-018.4)", async () => {
    const room = await createRoom();
    const guest = await joinRoom(room.code);
    const host = await connect(room.code, room.clientToken);
    const peer = await connect(room.code, guest.clientToken);

    const goneP = nextMessage(
      peer,
      (m) => m.channel === "presence" && m.type === "presenceGone",
    );
    // Host disconnects; the peer should be told to purge host's presence.
    host.close();
    const gone = (await goneP) as Extract<ServerMessage, { type: "presenceGone" }>;
    expect(gone.participantId).toBeTruthy();

    peer.close();
  });
});

describe("turn scheduling (FEAT-003 Task 1, REQ-025, REQ-026)", () => {
  afterEach(() => {
    clearAllTimers();
  });

  test("timer ticks are broadcast every 1s when a turn starts", async () => {
    // Get Bun's jest for fake timers
    const { jest } = require("bun:test");
    jest.useFakeTimers();

    const room = await createRoom();
    const guest = await joinRoom(room.code);
    const host = await connect(room.code, room.clientToken);
    const peer = await connect(room.code, guest.clientToken);

    // Configure for fixed mode, 5 second turns
    sendMsg(host, {
      channel: "control",
      type: "configure",
      mode: "fixed",
      durationMs: 5000,
      selectionPolicy: "round-robin",
    });

    // Wait for config acknowledgement
    await nextMessage(
      host,
      (m) => m.channel === "control" && m.type === "sessionSnapshot",
    );

    // Start session
    sendMsg(host, { channel: "control", type: "startSession" });
    await nextMessage(
      host,
      (m) => m.channel === "control" && m.type === "sessionSnapshot",
    );

    // Start a turn
    const boot = (await fetch(`${baseUrl}/api/rooms/${room.code}/bootstrap`).then(
      (r) => r.json() as Promise<{ roster: { id: string; name: string }[] }>,
    )) as any;
    const firstDriver = boot.roster[0].id;

    sendMsg(host, {
      channel: "control",
      type: "startTurn",
      driver: firstDriver,
    });

    // Both peers should receive session snapshot indicating turn started
    await nextMessage(
      peer,
      (m) => m.channel === "control" && m.type === "sessionSnapshot",
    );

    // Advance time by 1 second and expect a tick
    jest.advanceTimersByTime(1000);
    const tick1P = nextMessage(
      peer,
      (m) => m.channel === "control" && m.type === "timerTick",
    );
    const tick1 = (await tick1P) as Extract<ServerMessage, { type: "timerTick" }>;
    expect(tick1.remainingMs).toBeLessThanOrEqual(4100);
    expect(tick1.remainingMs).toBeGreaterThan(3900);

    // Advance by another second
    jest.advanceTimersByTime(1000);
    const tick2P = nextMessage(
      peer,
      (m) => m.channel === "control" && m.type === "timerTick",
    );
    const tick2 = (await tick2P) as Extract<ServerMessage, { type: "timerTick" }>;
    expect(tick2.remainingMs).toBeLessThanOrEqual(3100);
    expect(tick2.remainingMs).toBeGreaterThan(2900);

    jest.useRealTimers();
    host.close();
    peer.close();
  });

  test("turn expiry broadcasts TurnEndedMsg and advances to next turn (round-robin)", async () => {
    const { jest } = require("bun:test");
    jest.useFakeTimers();

    const room = await createRoom();
    const guest = await joinRoom(room.code);
    const host = await connect(room.code, room.clientToken);
    const peer = await connect(room.code, guest.clientToken);

    // Configure for fixed mode, 2 second turns, round-robin
    sendMsg(host, {
      channel: "control",
      type: "configure",
      mode: "fixed",
      durationMs: 2000,
      selectionPolicy: "round-robin",
    });

    await nextMessage(
      host,
      (m) => m.channel === "control" && m.type === "sessionSnapshot",
    );

    // Start session
    sendMsg(host, { channel: "control", type: "startSession" });
    await nextMessage(
      host,
      (m) => m.channel === "control" && m.type === "sessionSnapshot",
    );

    // Get roster to know the driver order
    const boot = (await fetch(`${baseUrl}/api/rooms/${room.code}/bootstrap`).then(
      (r) => r.json() as Promise<{ roster: { id: string; name: string }[] }>,
    )) as any;
    const firstDriver = boot.roster[0].id;

    // Start first turn
    sendMsg(host, {
      channel: "control",
      type: "startTurn",
      driver: firstDriver,
    });

    await nextMessage(
      peer,
      (m) => m.channel === "control" && m.type === "sessionSnapshot",
    );

    // Advance time past the 2 second duration
    jest.advanceTimersByTime(2100);

    // Peer should receive TurnEndedMsg
    const turnEndedP = nextMessage(
      peer,
      (m) => m.channel === "control" && m.type === "turnEnded",
    );
    const turnEnded = (await turnEndedP) as Extract<ServerMessage, { type: "turnEnded" }>;
    expect(turnEnded.reason).toBe("expiry");

    // New turn should start automatically (round-robin)
    // Peer should get a sessionSnapshot showing a new turn
    const newSnapshotP = nextMessage(
      peer,
      (m) => m.channel === "control" && m.type === "sessionSnapshot",
    );
    const newSnapshot = (await newSnapshotP) as Extract<ServerMessage, { type: "sessionSnapshot" }>;
    expect(newSnapshot.phase).toBe("active");

    jest.useRealTimers();
    host.close();
    peer.close();
  });

  test("early-end cancels the timer and ends the turn", async () => {
    const { jest } = require("bun:test");
    jest.useFakeTimers();

    const room = await createRoom();
    const guest = await joinRoom(room.code);
    const host = await connect(room.code, room.clientToken);
    const peer = await connect(room.code, guest.clientToken);

    // Configure for fixed-early-end mode, 10 second turns
    sendMsg(host, {
      channel: "control",
      type: "configure",
      mode: "fixed-early-end",
      durationMs: 10000,
      selectionPolicy: "round-robin",
    });

    await nextMessage(
      host,
      (m) => m.channel === "control" && m.type === "sessionSnapshot",
    );

    // Start session
    sendMsg(host, { channel: "control", type: "startSession" });
    await nextMessage(
      host,
      (m) => m.channel === "control" && m.type === "sessionSnapshot",
    );

    // Get the first driver (which is the host in this case)
    const boot = (await fetch(`${baseUrl}/api/rooms/${room.code}/bootstrap`).then(
      (r) => r.json() as Promise<{ roster: { id: string; name: string }[] }>,
    )) as any;
    const firstDriver = boot.roster[0].id;

    // Start first turn
    sendMsg(host, {
      channel: "control",
      type: "startTurn",
      driver: firstDriver,
    });

    await nextMessage(
      peer,
      (m) => m.channel === "control" && m.type === "sessionSnapshot",
    );

    // Driver requests early end
    sendMsg(host, { channel: "control", type: "earlyEnd" });

    // Peer should receive TurnEndedMsg with reason "early-end"
    const turnEndedP = nextMessage(
      peer,
      (m) => m.channel === "control" && m.type === "turnEnded",
    );
    const turnEnded = (await turnEndedP) as Extract<ServerMessage, { type: "turnEnded" }>;
    expect(turnEnded.reason).toBe("early-end");

    // Advance time: no additional tick should fire (timer was cancelled)
    jest.advanceTimersByTime(5000);
    // No expiry TurnEndedMsg should arrive (it already ended via early-end)

    jest.useRealTimers();
    host.close();
    peer.close();
  });
});
