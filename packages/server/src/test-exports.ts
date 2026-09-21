/**
 * Re-exports for e2e test harness.
 * These are not part of the production server interface, only for testing.
 */

export { createAppWithDeps } from "./app";
export { createWebSocketHandler, tryUpgrade } from "./ws";
export type { SocketData } from "./ws";
