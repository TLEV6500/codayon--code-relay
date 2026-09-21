/**
 * Pure turn engine — the authoritative session state machine.
 *
 * All transitions are pure functions `(state, event) => state`. No I/O, no
 * timers, no transport (NFR-006). The server drives this reducer from WS/HTTP
 * events and broadcasts the resulting state; timers live in the server layer
 * and feed the reducer discrete events.
 *
 * This slice (Task 2) covers create → configure → start and the role model.
 * Turns, tokens, rotation, and disconnect handling are layered on in later
 * tasks without changing these foundations.
 */

import type {
  HostParticipation,
  Participant,
  ParticipantId,
  Role,
  SessionState,
  TurnConfig,
} from "./domain";

/** Roles a participant may join as (never "host") (REQ-006.1). */
export type JoinableRole = Exclude<Role, "host">;

/** Discrete events the reducer understands. */
export type EngineEvent =
  | {
      readonly type: "participantJoined";
      readonly id: ParticipantId;
      readonly name: string;
      readonly role: JoinableRole;
    }
  | { readonly type: "participantLeft"; readonly id: ParticipantId }
  | {
      readonly type: "connectionChanged";
      readonly id: ParticipantId;
      readonly connected: boolean;
    }
  | {
      readonly type: "configured";
      readonly by: ParticipantId;
      readonly config: TurnConfig;
    }
  | { readonly type: "sessionStarted"; readonly by: ParticipantId }
  | { readonly type: "sessionEnded"; readonly by: ParticipantId }
  | {
      readonly type: "tokenGranted";
      readonly to: ParticipantId;
    }
  | {
      readonly type: "tokenRevoked";
      readonly from: ParticipantId;
    };

export interface CreateSessionInput {
  readonly roomId: string;
  readonly hostId: ParticipantId;
  readonly hostName: string;
  readonly hostParticipation: HostParticipation;
}

/** Creates a fresh session in the "created" phase with the host registered. */
export function createSession(input: CreateSessionInput): SessionState {
  const host: Participant = {
    id: input.hostId,
    role: "host",
    name: input.hostName,
    connected: true,
  };
  return {
    roomId: input.roomId,
    phase: "created",
    hostId: input.hostId,
    hostParticipation: input.hostParticipation,
    turnConfig: null,
    participants: new Map([[host.id, host]]),
    editTokenHolder: null,
  };
}

/**
 * Whether a participant is currently eligible to hold the edit token
 * (REQ-005.3, REQ-006.2/3):
 *  - spectators: never
 *  - observers: yes
 *  - host: only when host-participant
 */
export function isEligibleForToken(
  state: SessionState,
  id: ParticipantId,
): boolean {
  const p = state.participants.get(id);
  if (!p) return false;
  if (p.role === "spectator") return false;
  if (p.role === "host") return state.hostParticipation === "host-participant";
  return p.role === "observer";
}

/** Returns true when the actor holds host-administration authority (REQ-005). */
function isHost(state: SessionState, actor: ParticipantId): boolean {
  return actor === state.hostId;
}

function withParticipants(
  state: SessionState,
  participants: ReadonlyMap<ParticipantId, Participant>,
): SessionState {
  return { ...state, participants };
}

function isValidConfig(config: TurnConfig): boolean {
  if (config.durationMs <= 0) return false;
  if (config.mode !== "fixed" && config.mode !== "fixed-early-end") return false;
  if (
    config.selectionPolicy !== "round-robin" &&
    config.selectionPolicy !== "manual"
  ) {
    return false;
  }
  return true;
}

/** Pure reducer. Invalid transitions return the input state unchanged. */
export function applyEvent(state: SessionState, event: EngineEvent): SessionState {
  // No mutations are accepted once the session has ended (REQ-004.3).
  if (state.phase === "ended") return state;

  switch (event.type) {
    case "participantJoined": {
      // A joining attendee may only be observer or spectator (REQ-006.1).
      if (event.role !== "observer" && event.role !== "spectator") return state;
      if (state.participants.has(event.id)) return state;
      const next = new Map(state.participants);
      next.set(event.id, {
        id: event.id,
        role: event.role,
        name: event.name,
        connected: true,
      });
      return withParticipants(state, next);
    }

    case "participantLeft": {
      // The host is retained (host-token binding handled later, REQ-022).
      if (event.id === state.hostId) return state;
      if (!state.participants.has(event.id)) return state;
      const next = new Map(state.participants);
      next.delete(event.id);
      return withParticipants(state, next);
    }

    case "connectionChanged": {
      const p = state.participants.get(event.id);
      if (!p) return state;
      if (p.connected === event.connected) return state;
      const next = new Map(state.participants);
      next.set(event.id, { ...p, connected: event.connected });
      return withParticipants(state, next);
    }

    case "configured": {
      // Only the host may configure (REQ-005.1/2) and only before turns begin.
      if (!isHost(state, event.by)) return state;
      if (state.phase !== "created") return state;
      if (!isValidConfig(event.config)) return state;
      return { ...state, turnConfig: event.config };
    }

    case "sessionStarted": {
      // Host-only (REQ-005.2); requires a valid config (REQ-007.3).
      if (!isHost(state, event.by)) return state;
      if (state.phase !== "created") return state;
      if (state.turnConfig === null) return state;
      return { ...state, phase: "active" };
    }

    case "sessionEnded": {
      // Host-only (REQ-004.1, REQ-005.1).
      if (!isHost(state, event.by)) return state;
      return { ...state, phase: "ended" };
    }

    case "tokenGranted": {
      // Token can only be granted to eligible participants (REQ-012.2).
      if (!isEligibleForToken(state, event.to)) return state;
      // Revoke from previous holder if any, then grant to new holder (REQ-012.3).
      return { ...state, editTokenHolder: event.to };
    }

    case "tokenRevoked": {
      // Revoke only if they currently hold it (REQ-012.3).
      if (state.editTokenHolder !== event.from) return state;
      return { ...state, editTokenHolder: null };
    }

    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
