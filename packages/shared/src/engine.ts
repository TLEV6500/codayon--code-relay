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
  DisconnectState,
  HostParticipation,
  Participant,
  ParticipantId,
  Role,
  RotationState,
  SessionState,
  Turn,
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
    }
  | {
      readonly type: "turnStarted";
      readonly by: ParticipantId;
      readonly driver: ParticipantId;
      readonly startedAt: number;
    }
  | {
      readonly type: "turnEnded";
      readonly reason: "expiry" | "early-end" | "host-action";
      readonly endedAt: number;
    }
  | {
      readonly type: "turnAdvanced";
      readonly nextDriver: ParticipantId;
      readonly startedAt: number;
    }
  | {
      readonly type: "earlyEndRequested";
      readonly by: ParticipantId;
    }
  | {
      readonly type: "driverDisconnected";
      readonly driverId: ParticipantId;
      readonly disconnectedAt: number;
      readonly gracePeriodMs: number;
    }
  | {
      readonly type: "gracePeriodElapsed";
      readonly disconnectedId: ParticipantId;
    }
  | {
      readonly type: "hostActionTaken";
      readonly action: "reassign" | "extend" | "skip";
      readonly by: ParticipantId;
      readonly nextDriver?: ParticipantId;
    }
  | {
      readonly type: "driverReconnected";
      readonly driverId: ParticipantId;
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
    currentTurn: null,
    rotation: null,
    disconnectState: null,
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

/**
 * Find the next connected eligible driver starting from nextIndex (REQ-021: skip disconnected).
 * Returns the first connected participant who:
 * - is in the rotation order
 * - is currently connected
 * - is eligible for the token
 * If no connected eligible participant exists, returns null.
 *
 * Used by Task 11 (non-driver disconnect/rejoin) server integration to skip
 * disconnected observers during turn advancement.
 */
export function findNextConnectedDriver(
  state: SessionState,
): { driver: ParticipantId; index: number } | null {
  if (!state.rotation) return null;

  const order = state.rotation.order;
  if (order.length === 0) return null;

  // Start searching from nextIndex, wrapping around
  for (let i = 0; i < order.length; i++) {
    const idx = (state.rotation.nextIndex + i) % order.length;
    const candidateId = order[idx];
    if (candidateId === undefined) continue;

    const candidate = state.participants.get(candidateId);

    // Check if connected and eligible (REQ-021: skip disconnected)
    if (candidate && candidate.connected && isEligibleForToken(state, candidateId)) {
      return { driver: candidateId, index: idx };
    }
  }

  return null;
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

/**
 * Initialize round-robin rotation from current eligible participants.
 * (REQ-011.1: deterministic order based on insertion order).
 */
function initializeRotation(state: SessionState): RotationState | null {
  if (!state.turnConfig || state.turnConfig.selectionPolicy !== "round-robin") {
    return null;
  }

  // Collect eligible participants in insertion order.
  const order: ParticipantId[] = [];
  for (const [id, _participant] of state.participants) {
    if (isEligibleForToken(state, id)) {
      order.push(id);
    }
  }

  return {
    order: order as readonly ParticipantId[],
    nextIndex: 0,
    hasDrivenInCycle: new Set<ParticipantId>(),
  };
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
      const newState = withParticipants(state, next);

      // If round-robin and the new participant is eligible, recalculate rotation (REQ-011.2, REQ-025).
      if (newState.rotation && isEligibleForToken(newState, event.id)) {
        // Fair late-comer insertion: place after those who haven't driven in this cycle.
        const hasNotDriven = newState.rotation.order.filter(
          (id) => !newState.rotation!.hasDrivenInCycle.has(id),
        );
        const hasDriven = newState.rotation.order.filter((id) =>
          newState.rotation!.hasDrivenInCycle.has(id),
        );

        // Insert late-comer after those who haven't driven yet (at the end of hasNotDriven section).
        const newOrder = [...hasNotDriven, event.id, ...hasDriven];
        const newRotation: RotationState = {
          ...newState.rotation,
          order: newOrder as readonly ParticipantId[],
        };

        return { ...newState, rotation: newRotation };
      }

      return newState;
    }

    case "participantLeft": {
      // The host is retained (host-token binding handled later, REQ-022).
      if (event.id === state.hostId) return state;
      if (!state.participants.has(event.id)) return state;
      const next = new Map(state.participants);
      next.delete(event.id);
      const newState = withParticipants(state, next);

      // If round-robin, remove from rotation and potentially adjust nextIndex (REQ-011.3).
      if (newState.rotation) {
        const newOrder = newState.rotation.order.filter((id) => id !== event.id);
        let newIndex = newState.rotation.nextIndex;
        // If we removed someone before or at nextIndex, don't change index (it now points to the next person).
        // If newOrder is now empty, wrap to 0.
        if (newOrder.length === 0) {
          newIndex = 0;
        } else if (newIndex >= newOrder.length) {
          newIndex = 0; // Wrap around.
        }

        const newRotation: RotationState = {
          ...newState.rotation,
          order: newOrder as readonly ParticipantId[],
          nextIndex: newIndex,
        };

        return { ...newState, rotation: newRotation };
      }

      return newState;
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

      // Initialize rotation if round-robin policy is selected (REQ-011.1).
      const newRotation = initializeRotation({
        ...state,
        turnConfig: event.config,
      });

      return { ...state, turnConfig: event.config, rotation: newRotation };
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

    case "turnStarted": {
      // Only the host may start a turn (REQ-005.1).
      if (!isHost(state, event.by)) return state;
      // Session must be active and configured (REQ-007.3, REQ-009.1).
      if (state.phase !== "active" || !state.turnConfig) return state;
      // The driver must be eligible (REQ-012.2).
      if (!isEligibleForToken(state, event.driver)) return state;

      // Create a new turn and grant the token to the driver (REQ-009.1).
      const newTurn: Turn = {
        number: (state.currentTurn?.number ?? 0) + 1,
        driverId: event.driver,
        startedAt: event.startedAt,
        ended: false,
      };

      return {
        ...state,
        currentTurn: newTurn,
        editTokenHolder: event.driver,
      };
    }

    case "turnEnded": {
      // Exactly-one turn-end resolution (REQ-024): guard against double-end.
      if (!state.currentTurn || state.currentTurn.ended) return state;

      // Mark the turn as ended.
      return {
        ...state,
        currentTurn: { ...state.currentTurn, ended: true },
      };
    }

    case "turnAdvanced": {
      // Advance to the next driver after a turn ends (REQ-009.3).
      // The next driver must be eligible (REQ-012.2).
      if (!isEligibleForToken(state, event.nextDriver)) return state;

      // Create a new turn for the next driver.
      const newTurn: Turn = {
        number: (state.currentTurn?.number ?? 0) + 1,
        driverId: event.nextDriver,
        startedAt: event.startedAt,
        ended: false,
      };

      let newState: SessionState = {
        ...state,
        currentTurn: newTurn,
        editTokenHolder: event.nextDriver,
      };

      // If round-robin, update rotation state (REQ-011.1: deterministic advance).
      if (newState.rotation && state.currentTurn) {
        // Mark the driver who just finished as having driven in this cycle.
        const newHasDriven = new Set(newState.rotation.hasDrivenInCycle);
        newHasDriven.add(state.currentTurn.driverId);

        // Advance nextIndex. If all drivers have driven, reset for next cycle (REQ-011.1).
        let newNextIndex = (newState.rotation.nextIndex + 1) % newState.rotation.order.length;
        let newHasDrivenReset = newHasDriven;
        if (newHasDriven.size === newState.rotation.order.length) {
          // All have driven in this cycle; reset for next cycle.
          newHasDrivenReset = new Set<ParticipantId>();
          newNextIndex = (newState.rotation.nextIndex + 1) % newState.rotation.order.length;
        }

        const newRotation: RotationState = {
          ...newState.rotation,
          nextIndex: newNextIndex,
          hasDrivenInCycle: newHasDrivenReset,
        };

        newState = { ...newState, rotation: newRotation };
      }

      return newState;
    }

    case "earlyEndRequested": {
      // Only the current driver can request early-end (REQ-010.3/4).
      if (!state.currentTurn || state.currentTurn.driverId !== event.by) return state;
      // Early-end is only allowed in early-end mode (REQ-010.4).
      if (state.turnConfig?.mode !== "fixed-early-end") return state;
      // The server will handle the actual turn end; this is just validation.
      // Return the state unchanged; the server drives the turnEnded event.
      return state;
    }

    case "driverDisconnected": {
      // Only trigger if there's an active turn (REQ-020.1).
      if (!state.currentTurn || state.currentTurn.driverId !== event.driverId) return state;
      // Set disconnect grace period (REQ-020.1: pause timer, hold token).
      const newDisconnect: DisconnectState = {
        disconnectedId: event.driverId,
        disconnectedAt: event.disconnectedAt,
        gracePeriodMs: event.gracePeriodMs,
        hostAction: null,
      };
      return { ...state, disconnectState: newDisconnect };
    }

    case "gracePeriodElapsed": {
      // Only process if a disconnect is in progress for this participant.
      if (!state.disconnectState || state.disconnectState.disconnectedId !== event.disconnectedId) {
        return state;
      }
      // If host hasn't acted and policy is round-robin, auto-advance (REQ-020.4).
      if (
        state.disconnectState.hostAction === null &&
        state.turnConfig?.selectionPolicy === "round-robin" &&
        state.rotation
      ) {
        // Auto-advance to next in rotation.
        const nextIdx = (state.rotation.nextIndex + 1) % state.rotation.order.length;
        const nextDriver = state.rotation.order[nextIdx];
        if (nextDriver && isEligibleForToken(state, nextDriver)) {
          const newRotation: RotationState = {
            ...state.rotation,
            nextIndex: nextIdx,
          };
          return {
            ...state,
            rotation: newRotation,
            disconnectState: null,
            currentTurn: state.currentTurn ? { ...state.currentTurn, ended: true } : null,
            // Server will drive turnAdvanced event with the next driver.
          };
        }
      }
      // If manual pass, keep turn paused until host acts (REQ-020.5).
      // Return unchanged; server tracks the grace period elapsed.
      return state;
    }

    case "hostActionTaken": {
      // Only the host may take an action (REQ-005.1).
      if (!isHost(state, event.by)) return state;
      // Only process if a disconnect is in progress.
      if (!state.disconnectState) return state;

      // Update the disconnect state with the action (REQ-020.2).
      const updated: DisconnectState = {
        ...state.disconnectState,
        hostAction: event.action,
      };

      // If reassign: host picks a new driver; server will drive turnAdvanced.
      // If extend: hold for reconnect attempt.
      // If skip: advance to next driver; server will drive turnAdvanced.

      return { ...state, disconnectState: updated };
    }

    case "driverReconnected": {
      // If driver reconnects within grace period and no host action (REQ-020.3).
      if (!state.disconnectState || state.disconnectState.disconnectedId !== event.driverId) {
        return state;
      }
      if (state.disconnectState.hostAction === null) {
        // Restore token and clear disconnect state; server resumes timer (REQ-020.3).
        return { ...state, disconnectState: null };
      }
      // If host has already acted, ignore reconnect; session continues with new driver.
      return { ...state, disconnectState: null };
    }

    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
