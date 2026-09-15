import { Hono } from "hono";
import { cors } from "hono/cors";
import { banner, PROTOCOL_VERSION } from "@codayon/shared";

/**
 * Builds the Hono HTTP application. Kept separate from `Bun.serve` startup so
 * tests can exercise routes via `app.fetch(new Request(...))` without opening a
 * socket.
 */
export function createApp(): Hono {
  const app = new Hono();

  app.use("*", cors());

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      product: banner(),
      protocolVersion: PROTOCOL_VERSION,
    }),
  );

  return app;
}
