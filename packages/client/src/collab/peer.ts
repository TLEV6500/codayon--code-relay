/**
 * CodeMirror `@codemirror/collab` peer wired to the relay transport.
 *
 * Contract (matches the server authority in `server/src/relay.ts`):
 *  - On mount, the caller has already fetched the start document + version
 *    (via HTTP bootstrap or a `getDocument` round-trip) and seeds the editor.
 *  - The peer PUSHES local `sendableUpdates` with its synced version.
 *  - The relay broadcasts accepted `updates` to every peer; this plugin applies
 *    them with `receiveUpdates`, which also removes the peer's own confirmed
 *    updates from the sendable queue.
 *
 * Optimistic local editing (REQ-016.2) is inherent: local changes apply
 * immediately and are reconciled against the authority's ordering on receive.
 */

import {
  collab,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
  type Update,
} from "@codemirror/collab";
import { ChangeSet } from "@codemirror/state";
import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from "@codemirror/view";
import type { WireUpdate } from "@codayon/shared";
import type { RelayConnection } from "./transport";

function toWire(u: Update): WireUpdate {
  return { clientID: u.clientID, changes: u.changes.toJSON() };
}

function fromWire(w: WireUpdate): Update {
  return { clientID: w.clientID, changes: ChangeSet.fromJSON(w.changes) };
}

/**
 * Builds the collab extension + a view plugin that syncs with the relay.
 *
 * @param startVersion authoritative version the seeded document corresponds to
 * @param clientID stable per-connection collab client id
 * @param connection the open relay connection
 */
export function peerExtension(
  startVersion: number,
  clientID: string,
  connection: RelayConnection,
) {
  const plugin = ViewPlugin.fromClass(
    class implements PluginValue {
      private pushing = false;
      private unsubscribe: () => void;

      constructor(private readonly view: EditorView) {
        // Apply broadcast updates from the authority.
        this.unsubscribe = connection.onMessage((msg) => {
          if (msg.channel === "doc" && msg.type === "updates") {
            const updates = msg.updates.map(fromWire);
            this.view.dispatch(receiveUpdates(this.view.state, updates));
          }
        });
      }

      update(vu: ViewUpdate) {
        if (vu.docChanged) void this.push();
      }

      async push() {
        const updates = sendableUpdates(this.view.state);
        if (this.pushing || updates.length === 0) return;
        this.pushing = true;
        const version = getSyncedVersion(this.view.state);
        connection.send({
          channel: "doc",
          type: "pushUpdates",
          version,
          updates: updates.map(toWire),
        });
        this.pushing = false;
        // If more edits accumulated meanwhile, schedule another push.
        if (sendableUpdates(this.view.state).length) {
          setTimeout(() => void this.push(), 60);
        }
      }

      destroy() {
        this.unsubscribe();
      }
    },
  );

  return [collab({ startVersion, clientID }), plugin];
}
