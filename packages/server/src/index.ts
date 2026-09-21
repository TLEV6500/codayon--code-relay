import type { ServerWebSocket } from "bun";
import { createAppWithDeps } from "./app";

/**
 * Server entrypoint.
 *
 * Per the approved design: Hono handles the HTTP surface via `fetch: app.fetch`,
 * while the WebSocket path stays on Bun's NATIVE handler so we retain Bun's
 * native pub/sub (`ws.subscribe` / `server.publish`) and the raw `Server`
 * instance for efficient room broadcast. The relay is NOT routed through Hono's
 * `upgradeWebSocket` helper.
 *
 * The websocket handler is a placeholder here; the relay lands in Task 4 and
 * will share the same `registry`.
 */
const { app } = createAppWithDeps();
const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  fetch: app.fetch,
  websocket: {
    open(_ws: ServerWebSocket<unknown>) {},
    message(_ws: ServerWebSocket<unknown>, _message: string | Buffer) {},
    close(_ws: ServerWebSocket<unknown>) {},
  },
});

console.log(`Codayon relay listening on http://localhost:${server.port}`);
