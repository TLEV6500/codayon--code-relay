/**
 * Wire protocol message types (transport-agnostic).
 *
 * Three logical channels multiplexed over one connection per client:
 *  - Doc channel: authoritative document collaboration (`@codemirror/collab`).
 *  - Presence channel: transient cursor/selection awareness (REQ-018).
 *  - Control channel: session/turn/role events (REQ-005..012, REQ-020..024).
 *
 * Document `changes`/`updates` payloads are serialized `ChangeSet` JSON produced
 * by CodeMirror; they are typed as `unknown` here to keep `shared` free of an
 * editor dependency (the server and client attach the concrete codec).
 */

import type {
  HostParticipation,
  ParticipantId,
  Role,
  SelectionPolicy,
  TurnConfig,
  TurnMode,
} from "./domain";

/** A single collab update as it travels over the wire (serialized). */
export interface WireUpdate {
  /** Originating client id (collab `clientID`). */
  readonly clientID: string;
  /** Serialized `ChangeSet` JSON. */
  readonly changes: unknown;
}

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

/** Ask the authority for the current document + version (new/rejoining peer). */
export interface GetDocumentMsg {
  readonly channel: "doc";
  readonly type: "getDocument";
}

/** Ask for updates since a known version (long-polled over WS). */
export interface PullUpdatesMsg {
  readonly channel: "doc";
  readonly type: "pullUpdates";
  readonly version: number;
}

/** Submit local updates on top of a known version. */
export interface PushUpdatesMsg {
  readonly channel: "doc";
  readonly type: "pushUpdates";
  readonly version: number;
  readonly updates: readonly WireUpdate[];
}

/** Broadcast this client's cursor/selection (transient). */
export interface PresenceUpdateMsg {
  readonly channel: "presence";
  readonly type: "presence";
  /** Selection ranges as logical positions; interpreted by the editor layer. */
  readonly anchor: number;
  readonly head: number;
}

/** Host: configure turn mode + duration + selection policy (REQ-007/008). */
export interface ConfigureMsg {
  readonly channel: "control";
  readonly type: "configure";
  readonly mode: TurnMode;
  readonly durationMs: number;
  readonly selectionPolicy: SelectionPolicy;
}

/** Host: start the session / first turn (REQ-009.1). */
export interface StartSessionMsg {
  readonly channel: "control";
  readonly type: "startSession";
}

/** Host: end the session (REQ-004.1). */
export interface EndSessionMsg {
  readonly channel: "control";
  readonly type: "endSession";
}

/** Host: start a turn with a chosen driver (REQ-009.1, Task 7). */
export interface StartTurnMsg {
  readonly channel: "control";
  readonly type: "startTurn";
  readonly driver: ParticipantId;
}

/** Driver: request to end their turn early (REQ-010.3, Task 7). */
export interface EarlyEndMsg {
  readonly channel: "control";
  readonly type: "earlyEnd";
}

/** Host: resolve a disconnect grace period with an action (REQ-032, Task 6). */
export interface ResolveGraceMsg {
  readonly channel: "control";
  readonly type: "resolveGrace";
  readonly action: "reassign" | "extend" | "skip";
  /** New driver if action is "reassign"; omitted otherwise. */
  readonly newDriver?: ParticipantId;
}

export type ClientMessage =
  | GetDocumentMsg
  | PullUpdatesMsg
  | PushUpdatesMsg
  | PresenceUpdateMsg
  | ConfigureMsg
  | StartSessionMsg
  | EndSessionMsg
  | StartTurnMsg
  | EarlyEndMsg
  | ResolveGraceMsg;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

/** Authoritative document snapshot for a (re)joining peer. */
export interface DocumentMsg {
  readonly channel: "doc";
  readonly type: "document";
  readonly version: number;
  readonly doc: string;
}

/** New updates from the authority since the client's version. */
export interface UpdatesMsg {
  readonly channel: "doc";
  readonly type: "updates";
  readonly updates: readonly WireUpdate[];
}

/** A push was rejected (e.g., non-token-holder). Client should not apply. */
export interface PushRejectedMsg {
  readonly channel: "doc";
  readonly type: "pushRejected";
  readonly reason: "not-token-holder" | "spectator" | "session-ended";
}

/** Remote presence for another connected user. */
export interface RemotePresenceMsg {
  readonly channel: "presence";
  readonly type: "presence";
  readonly participantId: ParticipantId;
  readonly name: string;
  readonly anchor: number;
  readonly head: number;
}

/** A user's presence should be removed (disconnect) (REQ-018.4). */
export interface PresenceGoneMsg {
  readonly channel: "presence";
  readonly type: "presenceGone";
  readonly participantId: ParticipantId;
}

/** Role assignment / update for this client (REQ-002.3, REQ-023.2). */
export interface RoleAssignedMsg {
  readonly channel: "control";
  readonly type: "roleAssigned";
  readonly participantId: ParticipantId;
  readonly role: Role;
  readonly hostParticipation: HostParticipation;
}

/** Authoritative session snapshot (roster, phase, config). */
export interface SessionSnapshotMsg {
  readonly channel: "control";
  readonly type: "sessionSnapshot";
  readonly phase: "created" | "active" | "ended";
  readonly turnConfig: TurnConfig | null;
  readonly roster: readonly {
    readonly id: ParticipantId;
    readonly name: string;
    readonly role: Role;
    readonly connected: boolean;
  }[];
}

/** Round-robin rotation order snapshot (REQ-031). Broadcast when selectionPolicy='round-robin'. */
export interface RotationSnapshotMsg {
  readonly channel: "control";
  readonly type: "rotationSnapshot";
  /** Ordered list of participant IDs eligible for the rotation. */
  readonly order: readonly ParticipantId[];
  /** Index into order pointing to the next driver to be selected. */
  readonly nextIndex: number;
}

/** Session has ended; clients should tear down (REQ-004). */
export interface SessionEndedMsg {
  readonly channel: "control";
  readonly type: "sessionEnded";
}

/** A control action was rejected (e.g., non-host admin action) (REQ-005.2). */
export interface ControlRejectedMsg {
  readonly channel: "control";
  readonly type: "controlRejected";
  readonly reason: "not-host" | "not-configured" | "invalid-state";
}

/** Turn started; new driver has the token (REQ-009.1, Task 7). */
export interface TurnStartedMsg {
  readonly channel: "control";
  readonly type: "turnStarted";
  readonly turnNumber: number;
  readonly driver: ParticipantId;
  readonly driverName: string;
  readonly startedAt: number;
}

/** Turn ended; next turn beginning or turn ended (REQ-009.3, Task 7). */
export interface TurnEndedMsg {
  readonly channel: "control";
  readonly type: "turnEnded";
  readonly reason: "expiry" | "early-end" | "host-action";
  readonly endedAt: number;
}

/** Timer tick broadcast (REQ-010.1, Task 7). */
export interface TimerTickMsg {
  readonly channel: "control";
  readonly type: "timerTick";
  readonly remainingMs: number;
}

/** Disconnect grace period has started; driver/host disconnected mid-turn (REQ-032, Task 6). */
export interface DisconnectGraceStartedMsg {
  readonly channel: "control";
  readonly type: "disconnectGraceStarted";
  readonly participantId: ParticipantId;
  readonly participantName: string;
  readonly role: Role;
  readonly gracePeriodMs: number;
  readonly startedAt: number;
}

/** Disconnect grace period has resolved; auto-advance or host action taken (REQ-032, Task 6). */
export interface DisconnectGraceResolvedMsg {
  readonly channel: "control";
  readonly type: "disconnectGraceResolved";
  readonly resolution: "reconnected" | "reassigned" | "extended" | "skipped";
  readonly participantId: ParticipantId;
}

export type ServerMessage =
  | DocumentMsg
  | UpdatesMsg
  | PushRejectedMsg
  | RemotePresenceMsg
  | PresenceGoneMsg
  | RoleAssignedMsg
  | SessionSnapshotMsg
  | RotationSnapshotMsg
  | SessionEndedMsg
  | ControlRejectedMsg
  | TurnStartedMsg
  | TurnEndedMsg
  | TimerTickMsg
  | DisconnectGraceStartedMsg
  | DisconnectGraceResolvedMsg;
