/**
 * Server-side authoritative document (REQ-016/017).
 *
 * Implements the `@codemirror/collab` central-authority contract: it keeps an
 * ordered history of updates and the current document `Text`, and reconciles
 * out-of-date pushes via `rebaseUpdates`. This guarantees convergence — every
 * client that applies the same ordered history arrives at identical content —
 * and never silently drops an accepted edit.
 *
 * This class is a pure authority (no transport). Over our persistent WebSocket
 * we broadcast newly accepted updates proactively via Bun pub/sub rather than
 * long-polling; the WS layer calls {@link pushUpdates} and publishes the
 * returned accepted updates to the room topic. `pullUpdates` remains available
 * for a (re)joining peer to catch up from a known version (REQ-023).
 *
 * Wire payloads carry serialized `ChangeSet` JSON (see `WireUpdate`) so the
 * `shared` package stays editor-free; the (de)serialization lives here.
 */

import { ChangeSet, Text } from "@codemirror/state";
import { rebaseUpdates, type Update } from "@codemirror/collab";
import type { WireUpdate } from "@codayon/shared";

function toUpdate(w: WireUpdate): Update {
  return { clientID: w.clientID, changes: ChangeSet.fromJSON(w.changes) };
}

function toWire(u: Update): WireUpdate {
  return { clientID: u.clientID, changes: u.changes.toJSON() };
}

export class RoomDoc {
  /** Full ordered history; `updates.length` is the current version. */
  private updates: Update[] = [];
  private doc: Text;

  constructor(initial = "") {
    this.doc = Text.of(initial.length ? initial.split("\n") : [""]);
  }

  /** Current version number (count of accepted updates). */
  get version(): number {
    return this.updates.length;
  }

  /** Current authoritative document text. */
  get text(): string {
    return this.doc.toString();
  }

  /** Snapshot for a (re)joining peer (REQ-002.4, REQ-023.1). */
  getDocument(): { version: number; doc: string } {
    return { version: this.updates.length, doc: this.doc.toString() };
  }

  /** Returns updates accepted since `version` (empty if already current). */
  pullUpdates(version: number): readonly WireUpdate[] {
    if (version < 0 || version >= this.updates.length) return [];
    return this.updates.slice(version).map(toWire);
  }

  /**
   * Applies a client's pushed updates. If the client's `version` is stale, the
   * updates are rebased over the intervening history (REQ-017.3). Returns the
   * accepted updates (as wire form) on success, or null if the payload could
   * not be applied. Never drops an accepted edit (REQ-017.2).
   */
  pushUpdates(
    version: number,
    wire: readonly WireUpdate[],
  ): readonly WireUpdate[] | null {
    let received: readonly Update[];
    try {
      received = wire.map(toUpdate);
    } catch {
      return null;
    }

    if (version > this.updates.length) return null; // corrupt / impossible
    if (version < this.updates.length) {
      received = rebaseUpdates(received, this.updates.slice(version));
    }

    const accepted: WireUpdate[] = [];
    for (const update of received) {
      this.updates.push(update);
      this.doc = update.changes.apply(this.doc);
      accepted.push(toWire(update));
    }
    return accepted;
  }
}
