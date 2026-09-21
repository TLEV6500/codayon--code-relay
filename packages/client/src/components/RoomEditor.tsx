import { onCleanup, onMount, type Component } from "solid-js";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bootstrapRoom } from "../api";
import { connectRelay, type RelayConnection } from "../collab/transport";
import { peerExtension } from "../collab/peer";
import { presenceExtension } from "../collab/presence";

export interface RoomEditorProps {
  readonly code: string;
  readonly clientToken: string;
  /** Stable per-connection collab client id. */
  readonly clientID: string;
}

/**
 * Mounts a CodeMirror 6 editor bound to the room's authoritative document via
 * the collab peer. Bootstraps the start doc + version over HTTP, then keeps in
 * sync over the WebSocket relay.
 */
export const RoomEditor: Component<RoomEditorProps> = (props) => {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let connection: RelayConnection | undefined;

  onMount(async () => {
    const boot = await bootstrapRoom(props.code);
    connection = await connectRelay({
      code: props.code,
      clientToken: props.clientToken,
    });

    const state = EditorState.create({
      doc: boot.doc,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, monospace" },
        }),
        peerExtension(boot.version, props.clientID, connection),
        presenceExtension(connection),
      ],
    });

    view = new EditorView({ state, parent: host });
  });

  onCleanup(() => {
    view?.destroy();
    connection?.close();
  });

  return (
    <div
      ref={host}
      class="h-full w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-900"
    />
  );
};
