import type { Server } from "bun";
import { createAppWithDeps } from "./app";
import { createWebSocketHandler, tryUpgrade, type SocketData } from "./ws";

/**
 * Server entrypoint.
 *
 * Hono handles the HTTP surface via `app.fetch`, while the WebSocket path stays
 * on Bun's NATIVE handler so we retain Bun's native pub/sub (`ws.subscribe` /
 * `server.publish`) and the raw `Server` instance for efficient room broadcast.
 * The relay is NOT routed through Hono's `upgradeWebSocket` helper.
 *
 * The HTTP app and the WS layer share one `registry` so a socket can resolve the
 * room/participant created over HTTP.
 */
const { app, registry } = createAppWithDeps();
const port = Number(process.env.PORT ?? 3000);

// `server` is needed inside the WS handler (for `server.publish`) but is only
// available after `Bun.serve` returns; a late-bound getter breaks the cycle.
let server: Server<SocketData> | undefined;
const websocket = createWebSocketHandler(registry, () => server);

server = Bun.serve({
  port,
  fetch(req, srv) {
    // Attempt a WS upgrade first; fall through to Hono for normal HTTP.
    const upgrade = tryUpgrade(req, srv, registry);
    if (upgrade === "upgraded") return undefined;
    if (upgrade instanceof Response) return upgrade;
    return app.fetch(req, { server: srv });
  },
  websocket,
});

console.log(`Codayon relay listening on http://localhost:${server.port}`);
