/**
 * Presence extension (REQ-018): broadcast this client's cursor/selection and
 * render remote peers' cursors/selections as CodeMirror decorations.
 *
 * Presence is transient awareness data on its own channel, separate from the
 * authoritative document (REQ-018.3). Remote anchors are stored in a state
 * field and mapped through document changes so they stay at their intended
 * logical position as edits arrive (the anchoring foundation for REQ-015).
 */

import {
  StateEffect,
  StateField,
  RangeSetBuilder,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from "@codemirror/view";
import type { RelayConnection } from "./transport";
import type { ServerMessage } from "@codayon/shared";

/** A remote peer's presence, in local document coordinates. */
export interface RemotePresence {
  readonly participantId: string;
  readonly name: string;
  readonly anchor: number;
  readonly head: number;
}

/** Effect: upsert or remove a remote peer's presence. Exported for testing. */
export const setPresence = StateEffect.define<RemotePresence>();
export const removePresence = StateEffect.define<string>();

/** Deterministic color per participant id (stable label/cursor color). */
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 55%)`;
}

/**
 * State field holding all remote presences. Positions are mapped through
 * document changes so a remote cursor tracks its logical location as the local
 * document evolves (REQ-018 / REQ-015 foundation). Exported for testing.
 */
export const presenceField = StateField.define<RemotePresence[]>({
  create() {
    return [];
  },
  update(value, tr) {
    let next = value;

    if (tr.docChanged) {
      next = next.map((p) => ({
        ...p,
        anchor: tr.changes.mapPos(p.anchor),
        head: tr.changes.mapPos(p.head),
      }));
    }

    for (const effect of tr.effects) {
      if (effect.is(setPresence)) {
        const incoming = effect.value;
        next = [
          ...next.filter((p) => p.participantId !== incoming.participantId),
          incoming,
        ];
      } else if (effect.is(removePresence)) {
        const id = effect.value;
        next = next.filter((p) => p.participantId !== id);
      }
    }

    return next;
  },
});

/** Widget rendering a remote caret with a small name label. */
class CursorWidget extends WidgetType {
  constructor(
    private readonly name: string,
    private readonly color: string,
  ) {
    super();
  }

  eq(other: CursorWidget): boolean {
    return other.name === this.name && other.color === this.color;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-remote-cursor";
    wrap.style.borderLeft = `2px solid ${this.color}`;
    wrap.style.marginLeft = "-1px";
    wrap.style.position = "relative";

    const label = document.createElement("span");
    label.className = "cm-remote-cursor-label";
    label.textContent = this.name;
    label.style.background = this.color;
    label.style.color = "white";
    label.style.position = "absolute";
    label.style.top = "-1.1em";
    label.style.left = "-1px";
    label.style.fontSize = "10px";
    label.style.lineHeight = "1";
    label.style.padding = "1px 3px";
    label.style.borderRadius = "3px";
    label.style.whiteSpace = "nowrap";
    label.style.pointerEvents = "none";
    wrap.appendChild(label);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** Builds the decoration set for the current remote presences. */
function presenceDecorations(view: EditorView): DecorationSet {
  const presences = view.state.field(presenceField);
  const docLen = view.state.doc.length;

  // RangeSetBuilder requires additions in non-decreasing (from, startSide)
  // order, so collect every decoration first, then sort, then add in one pass.
  type Item = { from: number; to: number; side: number; deco: Decoration };
  const items: Item[] = [];

  for (const p of presences) {
    const color = colorFor(p.participantId);
    const from = Math.max(0, Math.min(p.anchor, p.head, docLen));
    const to = Math.max(0, Math.min(Math.max(p.anchor, p.head), docLen));
    if (from < to) {
      items.push({
        from,
        to,
        side: -1,
        deco: Decoration.mark({
          class: "cm-remote-selection",
          attributes: { style: `background-color: ${hexWithAlpha(color)}` },
        }),
      });
    }
    const pos = Math.max(0, Math.min(p.head, docLen));
    items.push({
      from: pos,
      to: pos,
      side: 1,
      deco: Decoration.widget({
        widget: new CursorWidget(p.name, color),
        side: 1,
      }),
    });
  }

  items.sort((a, b) => a.from - b.from || a.side - b.side);

  const builder = new RangeSetBuilder<Decoration>();
  for (const it of items) builder.add(it.from, it.to, it.deco);
  return builder.finish();
}

function hexWithAlpha(hsl: string): string {
  // Render selection as a translucent version of the cursor color.
  return hsl.replace(")", " / 0.25)").replace("hsl(", "hsl(");
}

const presenceDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = presenceDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.transactions.some((t) =>
          t.effects.some((e) => e.is(setPresence) || e.is(removePresence)),
        )
      ) {
        this.decorations = presenceDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Builds the presence extension.
 *
 * @param connection open relay connection (used to send local presence and
 *   receive remote presence/gone messages)
 */
export function presenceExtension(connection: RelayConnection): Extension {
  const sender = ViewPlugin.fromClass(
    class {
      private unsubscribe: () => void;
      private lastAnchor = -1;
      private lastHead = -1;

      constructor(private readonly view: EditorView) {
        this.unsubscribe = connection.onMessage((msg: ServerMessage) => {
          if (msg.channel !== "presence") return;
          if (msg.type === "presence") {
            this.view.dispatch({
              effects: setPresence.of({
                participantId: msg.participantId,
                name: msg.name,
                anchor: msg.anchor,
                head: msg.head,
              }),
            });
          } else if (msg.type === "presenceGone") {
            this.view.dispatch({ effects: removePresence.of(msg.participantId) });
          }
        });
        this.sendLocal();
      }

      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged) this.sendLocal();
      }

      private sendLocal() {
        const sel = this.view.state.selection.main;
        if (sel.anchor === this.lastAnchor && sel.head === this.lastHead) return;
        this.lastAnchor = sel.anchor;
        this.lastHead = sel.head;
        connection.send({
          channel: "presence",
          type: "presence",
          anchor: sel.anchor,
          head: sel.head,
        });
      }

      destroy() {
        this.unsubscribe();
      }
    },
  );

  return [presenceField, presenceDecorationPlugin, sender];
}
