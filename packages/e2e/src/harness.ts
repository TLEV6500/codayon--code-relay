import type { Server } from "bun";
import { createAppWithDeps, createWebSocketHandler, tryUpgrade, type SocketData } from "../../server/src/test-exports";
import * as fs from "fs";
import * as path from "path";

/**
 * E2E test harness: boots a real server + client on ephemeral ports for test isolation.
 *
 * Each test gets its own harness instance with its own ports, so tests don't interfere.
 * Within a test, multiple WebView instances can be opened against the same harness.
 */
export interface E2EHarness {
    /** Base URL for the client (e.g., http://127.0.0.1:54321) */
    readonly baseUrl: string;

    /** Opens a new WebView instance connected to this harness's client. */
    openView(): Promise<Bun.WebView>;

    /** Helper: creates a new room and returns its metadata. */
    createRoom(opts?: {
        lang?: string;
        turnsPerRound?: number;
        turnDurationMs?: number;
        earlyEndAllowed?: boolean;
        selectionPolicy?: "round-robin" | "manual";
    }): Promise<{
        code: string;
        hostToken: string;
        hostClientToken: string;
        observerClientToken: string;
    }>;

    /** Tears down both servers and closes all tracked WebView instances. */
    close(): Promise<void>;
}

interface TrackedView {
    view: Bun.WebView;
}

/**
 * Starts a new E2E harness: boots server + client servers on ephemeral ports.
 *
 * The client server reverse-proxies /api and /ws to the server, giving the
 * browser a single same-origin baseUrl (mirroring FEAT-002's nginx contract
 * but without nginx).
 */
export async function startHarness(): Promise<E2EHarness> {
    // Ensure client dist is built.
    const clientDistPath = path.resolve(
        import.meta.dir,
        "../../client/dist",
    );
    if (!fs.existsSync(clientDistPath)) {
        throw new Error(
            `Client dist not found at ${clientDistPath}. Run 'bun run build:client' first.`,
        );
    }

    // Create the app + registry for the server.
    const { app, registry } = createAppWithDeps();

    // Late-bind the server instance so the WS handler can access it for pub/sub.
    let serverInstance: Server<SocketData> | undefined;
    const websocket = createWebSocketHandler(registry, () => serverInstance);

    // Boot the server on port 0 (OS assigns ephemeral port).
    serverInstance = Bun.serve({
        port: 0,
        fetch(req, srv) {
            const upgrade = tryUpgrade(req, srv, registry);
            if (upgrade === "upgraded") return undefined;
            if (upgrade instanceof Response) return upgrade;
            return app.fetch(req, { server: srv });
        },
        websocket,
    });

    const serverPort = serverInstance.port;
    const serverUrl = `http://127.0.0.1:${serverPort}`;

    // Boot the client server on port 0.
    // It serves static files from dist, and proxies /api + /ws to the server.
    const clientServer = Bun.serve({
        port: 0,
        async fetch(req, server) {
            const url = new URL(req.url);

            // Proxy /api requests to the server.
            if (url.pathname.startsWith("/api")) {
                const targetUrl = `${serverUrl}${url.pathname}${url.search}`;
                return fetch(targetUrl, {
                    method: req.method,
                    headers: req.headers,
                    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
                });
            }

            // For /ws, upgrade to WebSocket and proxy to the server's WebSocket.
            if (url.pathname === "/ws") {
                // Use Bun's native upgrade support to proxy the WebSocket connection.
                // The success field being truthy indicates Bun has taken over the socket.
                const upgraded = server.upgrade(req);
                if (upgraded) {
                    return undefined; // Bun has handled it
                }
            }

            // Try to serve a file from dist.
            const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
            const fullPath = path.join(clientDistPath, filePath);

            // Prevent directory traversal.
            if (!fullPath.startsWith(clientDistPath)) {
                return new Response("Not found", { status: 404 });
            }

            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                const content = fs.readFileSync(fullPath);
                const contentType = getContentType(filePath);
                return new Response(content, {
                    headers: { "Content-Type": contentType },
                });
            }

            // SPA fallback: serve index.html for any route that doesn't have an extension.
            if (!path.extname(filePath)) {
                const indexPath = path.join(clientDistPath, "index.html");
                const content = fs.readFileSync(indexPath);
                return new Response(content, {
                    headers: { "Content-Type": "text/html; charset=utf-8" },
                });
            }

            return new Response("Not found", { status: 404 });
        },
        websocket: {
            // Handle WebSocket connections from clients and proxy them to the server.
            async open(ws) {
                const url = new URL(ws.url ?? "http://localhost/ws");
                const code = url.searchParams.get("code");
                const clientToken = url.searchParams.get("clientToken");

                if (!code || !clientToken) {
                    ws.close(1008, "Missing code or clientToken");
                    return;
                }

                // Connect to the actual server's WebSocket
                const serverWsUrl = new URL(serverUrl);
                serverWsUrl.protocol = serverWsUrl.protocol === "https:" ? "wss:" : "ws:";
                serverWsUrl.pathname = "/ws";
                serverWsUrl.searchParams.set("code", code);
                serverWsUrl.searchParams.set("clientToken", clientToken);

                try {
                    const serverWs = new WebSocket(serverWsUrl.toString());
                    let isActive = true;
                    
                    // Safety timeout: close connection after 5 minutes of inactivity or creation
                    const timeout = setTimeout(() => {
                        if (isActive && serverWs.readyState === WebSocket.OPEN) {
                            serverWs.close();
                        }
                    }, 5 * 60 * 1000);
                    
                    // Proxy messages from client to server
                    ws.onmessage = (msg) => {
                        if (serverWs.readyState === WebSocket.OPEN) {
                            serverWs.send(msg.data);
                        }
                    };

                    // Proxy messages from server to client
                    serverWs.onmessage = (msg) => {
                        if (ws.readyState === 1) { // OPEN
                            ws.send(msg.data);
                        }
                    };

                    serverWs.onclose = () => {
                        isActive = false;
                        clearTimeout(timeout);
                        try {
                            ws.close();
                        } catch {
                            // Already closed
                        }
                    };

                    serverWs.onerror = () => {
                        isActive = false;
                        clearTimeout(timeout);
                        try {
                            ws.close(1011, "Server error");
                        } catch {
                            // Already closed
                        }
                    };
                    
                    // Store reference so we can close it when client disconnects
                    (ws as any)._serverWs = serverWs;
                    (ws as any)._timeout = timeout;
                } catch (error) {
                    try {
                        ws.close(1011, "Failed to connect to server");
                    } catch {
                        // Already closed
                    }
                }
            },
            close(ws) {
                // Close the server-side WebSocket when client disconnects
                const serverWs = (ws as any)._serverWs;
                const timeout = (ws as any)._timeout;
                
                if (timeout) {
                    clearTimeout(timeout);
                }
                
                if (serverWs && serverWs.readyState === WebSocket.OPEN) {
                    console.log("[WebSocket] Closing server connection for client");
                    try {
                        serverWs.close();
                    } catch {
                        // Already closed
                    }
                }
            },
            message(ws, msg) {
                // Handled in open()
            },
        },
    });

    const clientPort = clientServer.port;
    const baseUrl = `http://127.0.0.1:${clientPort}`;

    const trackedViews: TrackedView[] = [];

    const harness: E2EHarness = {
        baseUrl,

        async openView(): Promise<Bun.WebView> {
            const view = new Bun.WebView({
                backend: "chrome",
                headless: true,

            });
            trackedViews.push({ view });
            return view;
        },

        async createRoom(_opts = {}) {
            // opts parameter kept for future use (e.g., custom turn duration, lang, etc.)
            // For now, we use server defaults.

            // Create room via the server's HTTP endpoint.
            const createRes = await fetch(`${serverUrl}/api/rooms`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    hostParticipation: "host-participant", // Host can also be a driver
                    hostName: "Host",
                }),
            });

            if (!createRes.ok) {
                throw new Error(
                    `Failed to create room: ${createRes.status} ${await createRes.text()}`,
                );
            }

            const room = (await createRes.json()) as {
                code: string;
                hostToken: string;
                clientToken: string;
            };
            const { code, hostToken, clientToken: hostClientToken } = room;

            // Join as observer to get an observer client token.
            const joinObsRes = await fetch(`${serverUrl}/api/rooms/${code}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    role: "observer",
                    name: "Observer",
                }),
            });

            if (!joinObsRes.ok) {
                throw new Error(
                    `Failed to join as observer: ${joinObsRes.status} ${await joinObsRes.text()}`,
                );
            }

            const joinedObs = (await joinObsRes.json()) as { clientToken: string };
            const observerClientToken = joinedObs.clientToken;

            return {
                code,
                hostToken,
                hostClientToken,
                observerClientToken,
            };
        },

        async close(): Promise<void> {
            // Close all tracked views.
            for (const { view } of trackedViews) {
                try {
                    view.close();
                } catch {
                    // Ignore errors if already closed.
                }
            }

            // Close servers. Note: Bun's `Server` type doesn't expose a close method;
            // we rely on process cleanup or manual tracking if needed.
            // For now, we just clear the reference.
            try {
                await serverInstance?.stop();
            } catch {
                // Ignore errors.
            }

            try {
                await clientServer.stop?.();
            } catch {
                // Ignore errors.
            }
        },
    };

    return harness;
}

/**
 * Infer Content-Type from file extension.
 */
function getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css",
        ".js": "application/javascript",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
    };
    return types[ext] ?? "application/octet-stream";
}
