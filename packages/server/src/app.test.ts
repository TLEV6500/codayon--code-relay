import { describe, expect, test } from "bun:test";
import { createApp } from "./app";

describe("server bootstrap", () => {
  test("GET /health returns ok with protocol version", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      protocolVersion: string;
    };
    expect(body.status).toBe("ok");
    expect(body.protocolVersion).toBe("0.1.0");
  });
});
