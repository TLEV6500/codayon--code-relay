/**
 * Transport-agnostic domain types for the turn-based relay (NFR-006).
 *
 * These describe the authoritative session model held by the relay. They contain
 * no I/O and no transport concerns so the same model can run under any future
 * transport.
 */

/** Ephemeral, session-scoped identifier for an attendee (REQ-003). */
export type ParticipantId = string;

/** Ephemeral, session-scoped room identifier. */
export type RoomId = string;

/**
 * Role of an attendee (REQ-006.1). Exactly one of these applies at a time.
 * The "Driver" is not a distinct role: it is the Host-as-participant or Observer
 * who currently holds the edit token (tracked separately on the session).
 */
export type Role = "host" | "observer" | "spectator";

/**
 * How the Host participates (REQ-001.2, REQ-005.3):
 * - "admin-only": Host administers but is never eligible for the edit token.
 * - "host-participant": Host is eligible for the edit token in the rotation.
 */
export type HostParticipation = "admin-only" | "host-participant";

/** Turn timing policy (REQ-007.1). */
export type TurnMode = "fixed" | "fixed-early-end";

/** Driver-selection policy (REQ-008.1). */
export type SelectionPolicy = "round-robin" | "manual";

/** Session lifecycle phase (Glossary: created → active → ended). */
export type SessionPhase = "created" | "active" | "ended";

/** Turn configuration set by the Host before turns begin (REQ-007). */
export interface TurnConfig {
  readonly mode: TurnMode;
  /** Turn duration in milliseconds (REQ-007.2). */
  readonly durationMs: number;
  readonly selectionPolicy: SelectionPolicy;
}

/** Active turn state (REQ-009/010/024). */
export interface Turn {
  /** Unique turn number, incremented each turn start. */
  readonly number: number;
  /** Participant driving this turn (holds the token). */
  readonly driverId: ParticipantId;
  /** Timestamp when turn started (server-side). */
  readonly startedAt: number;
  /**
   * Whether the turn has ended. Race guard for early-end vs timer expiry (REQ-024).
   * Used to ensure exactly-one turn-end resolution.
   */
  readonly ended: boolean;
}

/** A connected attendee and their session-scoped attributes. */
export interface Participant {
  readonly id: ParticipantId;
  readonly role: Role;
  /** Display name for presence/roster (non-authoritative). */
  readonly name: string;
  /**
   * Whether the participant is currently connected. Disconnected participants
   * are retained transiently for grace-period handling (REQ-020/021) but are
   * skipped by rotation while absent (REQ-011.3).
   */
  readonly connected: boolean;
}

/**
 * Authoritative session state. Pure data — all transitions happen through the
 * reducer in `engine.ts`. Ephemeral: never persisted (REQ-004.2).
 */
export interface SessionState {
  readonly roomId: RoomId;
  readonly phase: SessionPhase;
  readonly hostId: ParticipantId;
  readonly hostParticipation: HostParticipation;
  /** null until the Host completes turn configuration (REQ-007.3). */
  readonly turnConfig: TurnConfig | null;
  /** Participants keyed by id, insertion order preserved for fair rotation. */
  readonly participants: ReadonlyMap<ParticipantId, Participant>;
  /**
   * The participant currently holding the edit token (REQ-012.1/2).
   * null when no turn is active. At most one holder at any time (REQ-012.1).
   * Never granted to a spectator (REQ-012.2, REQ-006.2).
   */
  readonly editTokenHolder: ParticipantId | null;
  /**
   * The currently active turn, or null if no turn is in progress (REQ-009.1/2).
   * When a turn is active, editTokenHolder should equal turn.driverId.
   */
  readonly currentTurn: Turn | null;
  /**
   * Round-robin rotation state (REQ-008, REQ-011, REQ-025).
   * null when not using round-robin mode.
   */
  readonly rotation: RotationState | null;
}

/**
 * Round-robin rotation state (REQ-011: fair rotation with late-comer insertion).
 */
export interface RotationState {
  /**
   * Eligible participants in rotation order (list, not map, to preserve order).
   * Includes only eligible participants (observers + host-participant, not spectators).
   * Deterministic order: insertion order of participants (REQ-011.1).
   */
  readonly order: readonly ParticipantId[];
  /**
   * Index into `order` pointing to the next driver to be selected (REQ-011.1).
   * Advanced after each turn completes.
   */
  readonly nextIndex: number;
  /**
   * Participants who have driven in the current rotation cycle.
   * Used to insert late joiners fairly: they go after those who haven't yet driven
   * in this cycle (REQ-011.2, REQ-025.2).
   */
  readonly hasDrivenInCycle: ReadonlySet<ParticipantId>;
}
