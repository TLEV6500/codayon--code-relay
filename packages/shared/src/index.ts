/**
 * @codayon/shared — transport-agnostic protocol types and turn engine.
 *
 * This package intentionally contains NO I/O and NO transport code (NFR-006):
 * the session/role/turn/token/presence logic must be usable under any future
 * transport (e.g. LAN/P2P) without behavioral change.
 */

/** Identifies the shared protocol version negotiated between client and server. */
export const PROTOCOL_VERSION = "0.1.0" as const;

/** Human-readable product name. */
export const PRODUCT_NAME = "Codayon" as const;

/** Returns a short banner string; used as a bootstrap cross-package smoke check. */
export function banner(): string {
  return `${PRODUCT_NAME} relay protocol v${PROTOCOL_VERSION}`;
}

export * from "./domain";
export * from "./protocol";
export * from "./engine";
