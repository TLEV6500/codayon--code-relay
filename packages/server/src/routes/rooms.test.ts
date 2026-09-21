import { describe, expect, test } from "bun:test";
import { createAppWithDeps } from "../app";
import { RoomRegistry } from "../rooms";

function makeApp() {
  let codeN = 0;
  let tokenN = 0;
  let pidN = 0;
  const registry = new RoomRegistry({
    roomCode: () => `ROOM${++codeN}`,
    token: () => `tok-${++tokenN}`,
    participantId: () => `p${++pidN}`,
  });
  return createAppWithDeps({ registry });
}

async function post(app: ReturnType<typeof makeApp>["app"], path: string, body?: unknown) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

describe("POST /api/rooms (REQ-001)", () => {
  test("creates a room and returns code + host token + join url to the creator", async () => {
    const { app } = makeApp();
    const res = await post(app, "/api/rooms", {
      hostName: "Mentor",
      hostParticipation: "host-participant",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, string>;
    expect(body.code).toBe("ROOM1");
    expect(body.joinUrl).toBe("/room/ROOM1");
    expect(body.hostToken).toBeTruthy();
    expect(body.clientToken).toBeTruthy();
    expect(body.hostParticipation).toBe("host-participant");
  });

  test("defaults to admin-only host with an empty body", async () => {
    const { app } = makeApp();
    const res = await post(app, "/api/rooms");
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, string>;
    expect(body.hostParticipation).toBe("admin-only");
  });
});

describe("POST /api/rooms/:code/join (REQ-002)", () => {
  test("joins as observer", async () => {
    const { app } = makeApp();
    await post(app, "/api/rooms", { hostName: "M" });
    const res = await post(app, "/api/rooms/ROOM1/join", {
      role: "observer",
      name: "Ann",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(body.role).toBe("observer");
    expect(body.participantId).toBeTruthy();
    expect(body.clientToken).toBeTruthy();
  });

  test("joins as spectator", async () => {
    const { app } = makeApp();
    await post(app, "/api/rooms", { hostName: "M" });
    const res = await post(app, "/api/rooms/ROOM1/join", { role: "spectator" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(body.role).toBe("spectator");
  });

  test("rejects an invalid role (REQ-002.3)", async () => {
    const { app } = makeApp();
    await post(app, "/api/rooms", { hostName: "M" });
    const res = await post(app, "/api/rooms/ROOM1/join", { role: "host" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, string>;
    expect(body.error).toBe("invalid-role");
  });

  test("rejects join to an unknown room (REQ-002.2)", async () => {
    const { app } = makeApp();
    const res = await post(app, "/api/rooms/NOPE/join", { role: "observer" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, string>;
    expect(body.error).toBe("room-unavailable");
  });

  test("rejects join to an ended room (REQ-004.3)", async () => {
    const { app, registry } = makeApp();
    await post(app, "/api/rooms", { hostName: "M" });
    const room = registry.get("ROOM1")!;
    room.session = { ...room.session, phase: "ended" };
    const res = await post(app, "/api/rooms/ROOM1/join", { role: "observer" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/rooms/:code/bootstrap (REQ-002.4)", () => {
  test("returns the authoritative doc + roster", async () => {
    const { app } = makeApp();
    await post(app, "/api/rooms", { hostName: "M" });
    await post(app, "/api/rooms/ROOM1/join", { role: "observer", name: "Ann" });
    const res = await app.fetch(
      new Request("http://localhost/api/rooms/ROOM1/bootstrap"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: number;
      doc: string;
      phase: string;
      roster: { role: string }[];
    };
    expect(body.version).toBe(0);
    expect(body.doc).toBe("");
    expect(body.phase).toBe("created");
    expect(body.roster.length).toBe(2);
  });

  test("bootstrap of an unknown room is unavailable", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://localhost/api/rooms/NOPE/bootstrap"),
    );
    expect(res.status).toBe(404);
  });
});
