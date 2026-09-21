/**
 * In-memory room registry (REQ-001/002/003).
 *
 * Holds ephemeral session state for the lifetime of the server process only —
 * nothing is persisted (REQ-004.2). Each room bundles:
 *  - the authoritative `SessionState` (from the pure engine),
 *  - the authoritative collaborative document (`RoomDoc`: ordered update
 *    history + current text) used to order edits and bootstrap peers
 *    (REQ-002.4, REQ-016/017),
 *  - the secret host-ownership token (REQ-001.1), returned only to the creator.
 *
 * Identity is ephemeral and session-scoped (REQ-003.1). Generators are injected
 * so tests can make IDs/codes deterministic.
 */

import {
  applyEvent,
  createSession,
  type HostParticipation,
  type JoinableRole,
  type ParticipantId,
  type Role,
  type SessionState,
} from "@codayon/shared";
import { RoomDoc } from "./relay";

/** The transient server-side record for a single room/session. */
export interface Room {
  readonly code: string;
  /** Secret; authorizes host-administration actions (REQ-005). Never broadcast. */
  readonly hostToken: string;
  /** Authoritative session model (pure engine state). */
  session: SessionState;
  /** Authoritative collaborative document (ordered update history + text). */
  readonly doc: RoomDoc;
  /** Maps a participant's secret client token to their id (ephemeral). */
  readonly clientTokens: Map<string, ParticipantId>;
}

export interface CreateRoomInput {
  readonly hostName: string;
  readonly hostParticipation: HostParticipation;
}

export interface CreateRoomResult {
  readonly code: string;
  readonly hostToken: string;
  readonly hostId: ParticipantId;
  /** Per-connection secret used to authenticate the WS upgrade later. */
  readonly clientToken: string;
}

export interface JoinRoomResult {
  readonly participantId: ParticipantId;
  readonly role: JoinableRole;
  readonly clientToken: string;
}

export interface BootstrapResult {
  readonly version: number;
  readonly doc: string;
  readonly phase: SessionState["phase"];
  readonly roster: readonly {
    readonly id: ParticipantId;
    readonly name: string;
    readonly role: Role;
    readonly connected: boolean;
  }[];
  readonly participantId?: ParticipantId;
  readonly role?: Role;
  readonly hostParticipation?: HostParticipation;
}

/** Reasons a join/bootstrap can be denied (REQ-002.2, REQ-004.3). */
export type RoomError = "not-found" | "ended";

export interface Generators {
  /** Room join code (e.g., 6-char). */
  readonly roomCode: () => string;
  /** Opaque secret tokens (host token, client tokens). */
  readonly token: () => string;
  /** Ephemeral participant ids. */
  readonly participantId: () => ParticipantId;
}

const defaultGenerators: Generators = {
  roomCode: () => randomCode(6),
  token: () => crypto.randomUUID(),
  participantId: () => `p_${crypto.randomUUID()}`,
};

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars

function randomCode(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * The registry. In-memory, process-lifetime only. All mutations are localized
 * here; the pure engine remains the source of truth for session semantics.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly gen: Generators;

  constructor(generators: Partial<Generators> = {}) {
    this.gen = { ...defaultGenerators, ...generators };
  }

  /** REQ-001: create a room, host token, and host participant atomically. */
  create(input: CreateRoomInput): CreateRoomResult {
    // Guard against a (vanishingly unlikely) code collision so we never emit a
    // partially initialized room (REQ-001.4).
    let code = this.gen.roomCode();
    let attempts = 0;
    while (this.rooms.has(code)) {
      if (++attempts > 8) throw new Error("failed to allocate a unique room code");
      code = this.gen.roomCode();
    }

    const hostId = this.gen.participantId();
    const hostToken = this.gen.token();
    const clientToken = this.gen.token();

    const session = createSession({
      roomId: code,
      hostId,
      hostName: input.hostName,
      hostParticipation: input.hostParticipation,
    });

    const room: Room = {
      code,
      hostToken,
      session,
      doc: new RoomDoc(),
      clientTokens: new Map([[clientToken, hostId]]),
    };
    this.rooms.set(code, room);

    return { code, hostToken, hostId, clientToken };
  }

  /** REQ-002: join an active room as participant (observer) or spectator. */
  join(
    code: string,
    name: string,
    role: JoinableRole,
  ): JoinRoomResult | RoomError {
    const room = this.rooms.get(code);
    if (!room) return "not-found";
    if (room.session.phase === "ended") return "ended"; // REQ-004.3

    const participantId = this.gen.participantId();
    const clientToken = this.gen.token();

    room.session = applyEvent(room.session, {
      type: "participantJoined",
      id: participantId,
      name,
      role,
    });
    room.clientTokens.set(clientToken, participantId);

    return { participantId, role, clientToken };
  }

  /** REQ-002.4: current authoritative document + presence-less roster snapshot. */
  bootstrap(code: string, clientToken?: string): BootstrapResult | RoomError {
    const room = this.rooms.get(code);
    if (!room) return "not-found";
    if (room.session.phase === "ended") return "ended";

    const roster = [...room.session.participants.values()].map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      connected: p.connected,
    }));

    const snapshot = room.doc.getDocument();

    // If clientToken is provided, include the participant's role + host participation (REQ-035)
    if (clientToken) {
      const participantId = room.clientTokens.get(clientToken);
      if (participantId) {
        const participant = room.session.participants.get(participantId);
        if (participant) {
          return {
            version: snapshot.version,
            doc: snapshot.doc,
            phase: room.session.phase,
            roster,
            participantId,
            role: participant.role,
            hostParticipation: room.session.hostParticipation,
          };
        }
      }
    }

    return {
      version: snapshot.version,
      doc: snapshot.doc,
      phase: room.session.phase,
      roster,
    };
  }

  /** Look up a room (used by the WS layer in later tasks). */
  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Resolve a client token to its participant id within a room. */
  resolveClient(code: string, clientToken: string): ParticipantId | undefined {
    return this.rooms.get(code)?.clientTokens.get(clientToken);
  }

  /** Whether a client token authorizes host administration for a room (REQ-005). */
  isHostToken(code: string, hostToken: string): boolean {
    const room = this.rooms.get(code);
    return room != null && room.hostToken === hostToken;
  }

  /**
   * Clean up a room after session ends (REQ-004.1/2, REQ-003.3).
   * Purges doc, turn history, presence, participants, room code, and
   * invalidates all tokens. Called when session.phase transitions to "ended".
   */
  endRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;

    // Verify the session is actually ended before purging.
    if (room.session.phase !== "ended") return;

    // Purge the room from the registry (REQ-004.2: no persistence).
    // The in-memory data is discarded; tokens are invalidated.
    this.rooms.delete(code);
  }

  /** Test/introspection helper. */
  size(): number {
    return this.rooms.size;
  }
}
