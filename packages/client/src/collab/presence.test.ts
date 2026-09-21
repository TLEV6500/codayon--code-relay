import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import {
  presenceField,
  setPresence,
  removePresence,
  type RemotePresence,
} from "./presence";

function stateWith(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [presenceField] });
}

describe("presence state field (REQ-018 / REQ-015 foundation)", () => {
  test("stores a remote presence via effect", () => {
    let state = stateWith("hello world");
    const p: RemotePresence = {
      participantId: "p1",
      name: "Ann",
      anchor: 6,
      head: 6,
    };
    state = state.update({ effects: setPresence.of(p) }).state;
    const list = state.field(presenceField);
    expect(list.length).toBe(1);
    expect(list[0]?.head).toBe(6);
  });

  test("maps a remote anchor forward through an earlier insertion (no drift)", () => {
    let state = stateWith("hello world");
    // Remote cursor sits at offset 6 (start of "world").
    state = state
      .update({ effects: setPresence.of({ participantId: "p1", name: "Ann", anchor: 6, head: 6 }) })
      .state;
    // Insert 3 chars at the very start; the remote cursor should shift to 9,
    // still logically at the start of "world" rather than a stale offset 6.
    state = state.update({ changes: { from: 0, insert: "XYZ" } }).state;
    const list = state.field(presenceField);
    expect(list[0]?.anchor).toBe(9);
    expect(list[0]?.head).toBe(9);
    expect(state.doc.sliceString(9)).toBe("world");
  });

  test("does not move a remote anchor for an insertion after it", () => {
    let state = stateWith("hello world");
    state = state
      .update({ effects: setPresence.of({ participantId: "p1", name: "Ann", anchor: 2, head: 2 }) })
      .state;
    state = state.update({ changes: { from: 11, insert: "!!!" } }).state;
    expect(state.field(presenceField)[0]?.anchor).toBe(2);
  });

  test("upserts by participant id and removes on presenceGone", () => {
    let state = stateWith("abc");
    state = state
      .update({ effects: setPresence.of({ participantId: "p1", name: "Ann", anchor: 0, head: 1 }) })
      .state;
    state = state
      .update({ effects: setPresence.of({ participantId: "p1", name: "Ann", anchor: 2, head: 3 }) })
      .state;
    expect(state.field(presenceField).length).toBe(1);
    expect(state.field(presenceField)[0]?.anchor).toBe(2);

    state = state.update({ effects: removePresence.of("p1") }).state;
    expect(state.field(presenceField).length).toBe(0);
  });
});
