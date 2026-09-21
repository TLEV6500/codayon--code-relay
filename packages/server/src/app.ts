import { Hono } from "hono";
import { cors } from "hono/cors";
import { banner, PROTOCOL_VERSION } from "@codayon/shared";
import { RoomRegistry } from "./rooms";
import { roomRoutes } from "./routes/rooms";

export interface AppDeps {
  /** Injected so tests can share the instance and use deterministic generators. */
  readonly registry?: RoomRegistry;
}

export interface App {
  readonly app: Hono;
  readonly registry: RoomRegistry;
}

/**
 * Builds the Hono HTTP application plus the room registry it is bound to. Kept
 * separate from `Bun.serve` startup so tests can exercise routes via
 * `app.fetch(new Request(...))` without opening a socket.
 */
export function createAppWithDeps(deps: AppDeps = {}): App {
  const registry = deps.registry ?? new RoomRegistry();
  const app = new Hono();

  app.use("*", cors());

  // Centralized error handling so a thrown handler never leaks a stack trace
  // and never leaves a partially initialized room visible (REQ-001.4).
  app.onError((err, c) => {
    console.error("[http] unhandled error:", err);
    return c.json({ error: "internal", message: "Internal server error" }, 500);
  });

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      product: banner(),
      protocolVersion: PROTOCOL_VERSION,
    }),
  );

  app.route("/api", roomRoutes(registry));

  return { app, registry };
}

/** Convenience for callers that only need the Hono app (e.g., the health test). */
export function createApp(): Hono {
  return createAppWithDeps().app;
}
