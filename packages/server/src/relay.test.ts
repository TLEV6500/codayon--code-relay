import { describe, expect, test } from "bun:test";
import { ChangeSet, Text } from "@codemirror/state";
import { RoomDoc } from "./relay";
import type { WireUpdate } from "@codayon/shared";

/** Build a wire update that inserts `text` at `at` in a doc of length `len`. */
function insert(clientID: string, at: number, text: string, len: number): WireUpdate {
  const changes = ChangeSet.of({ from: at, to: at, insert: text }, len);
  return { clientID, changes: changes.toJSON() };
}

describe("RoomDoc authority (REQ-016/017)", () => {
  test("starts empty at version 0", () => {
    const doc = new RoomDoc();
    const snap = doc.getDocument();
    expect(snap.version).toBe(0);
    expect(snap.doc).toBe("");
  });

  test("accepts an in-order push and advances version + document", () => {
    const doc = new RoomDoc();
    const accepted = doc.pushUpdates(0, [insert("A", 0, "hello", 0)]);
    expect(accepted).not.toBeNull();
    const snap = doc.getDocument();
    expect(snap.version).toBe(1);
    expect(snap.doc).toBe("hello");
  });

  test("pullUpdates returns updates since a given version", () => {
    const doc = new RoomDoc();
    doc.pushUpdates(0, [insert("A", 0, "hi", 0)]);
    const since0 = doc.pullUpdates(0);
    expect(since0.length).toBe(1);
    const since1 = doc.pullUpdates(1);
    expect(since1.length).toBe(0);
  });

  test("rebases a push submitted against a stale version (REQ-017.3)", () => {
    const doc = new RoomDoc();
    // Client A inserts "abc" at 0 (version 0 -> 1).
    doc.pushUpdates(0, [insert("A", 0, "abc", 0)]);
    // Client B, still on version 0, inserts "X" at 0. Server rebases over A.
    const accepted = doc.pushUpdates(0, [insert("B", 0, "X", 0)]);
    expect(accepted).not.toBeNull();
    const snap = doc.getDocument();
    expect(snap.version).toBe(2);
    // Both inserts survive; no edit lost (REQ-017.2).
    expect(snap.doc.includes("abc")).toBe(true);
    expect(snap.doc.includes("X")).toBe(true);
    expect(snap.doc.length).toBe(4);
  });

  test("two peers converge to identical content after applying history", () => {
    const authority = new RoomDoc();
    authority.pushUpdates(0, [insert("A", 0, "foo", 0)]);
    authority.pushUpdates(1, [insert("A", 3, "bar", 3)]);

    // A fresh peer replays the full history from version 0.
    let peerDoc = Text.of([""]);
    for (const u of authority.pullUpdates(0)) {
      peerDoc = ChangeSet.fromJSON(u.changes).apply(peerDoc);
    }
    expect(peerDoc.toString()).toBe(authority.getDocument().doc);
    expect(peerDoc.toString()).toBe("foobar");
  });
});
