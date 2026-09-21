/**
 * Server-side turn timer scheduling (FEAT-003 Task 1).
 *
 * Manages the lifecycle of timers for fixed-duration turns:
 *  - scheduleTurnExpiry(durationMs) - schedules auto-expiry at the end of the turn
 *  - startTurnTicks() - broadcasts TimerTickMsg every 1s with remainingMs
 *  - cancelTurnTimers() - idempotent cleanup of both timers
 *
 * When a turn expires, the caller drives the turn-end event (REQ-025, REQ-026).
 * Timers are associated with a room; replacing timers prevents leaks via cancellation.
 *
 * This module is transport-agnostic: it schedules timers and returns callbacks
 * for the caller to invoke when ticks occur or the turn expires. The server layer
 * (ws.ts) owns the callbacks and drives session state transitions.
 */

import type { ParticipantId } from "@codayon/shared";

/**
 * Callback invoked each time a tick occurs (every 1s).
 * Caller should broadcast a TimerTickMsg with the remaining time.
 */
export type OnTickCallback = (remainingMs: number) => void;

/**
 * Callback invoked when a turn expires.
 * Caller should apply a turnEnded event, advance the turn, and broadcast state.
 */
export type OnExpiryCallback = () => void;

/**
 * Per-room timer state. Tracks both the turn-expiry timer and the tick interval.
 */
export interface TurnTimers {
  readonly expiryTimeoutId: ReturnType<typeof setTimeout> | null;
  readonly tickIntervalId: ReturnType<typeof setInterval> | null;
  readonly durationMs: number;
  readonly startedAt: number;
}

/**
 * Maps room codes to their active timers (null if no turn is active).
 */
const timersByRoom = new Map<string, TurnTimers>();

/**
 * Schedule a turn to expire after `durationMs` milliseconds.
 *
 * If timers already exist for this room, they are cancelled first (prevents leaks).
 * Invokes `onExpiry` when the timer fires.
 *
 * Returns the TurnTimers record for this room (or null if scheduling failed).
 *
 * @param code Room code
 * @param durationMs Turn duration in milliseconds
 * @param onExpiry Callback to invoke when turn expires
 */
export function scheduleTurnExpiry(
  code: string,
  durationMs: number,
  onExpiry: OnExpiryCallback,
): TurnTimers {
  // Cancel any existing timers to prevent leaks.
  cancelTurnTimers(code);

  const startedAt = Date.now();

  // Schedule the expiry callback to fire after the full duration.
  const expiryTimeoutId = setTimeout(() => {
    // Clear the records when expiry fires.
    timersByRoom.delete(code);
    onExpiry();
  }, durationMs);

  const timers: TurnTimers = {
    expiryTimeoutId,
    tickIntervalId: null,
    durationMs,
    startedAt,
  };

  timersByRoom.set(code, timers);
  return timers;
}

/**
 * Start broadcasting timer ticks every 1 second.
 *
 * Must be called after scheduleTurnExpiry() to activate ticks.
 * Invokes `onTick` each second with the remaining time in milliseconds.
 * Ticks stop automatically when the turn expires (via cancelTurnTimers cleanup).
 *
 * @param code Room code
 * @param onTick Callback to invoke each tick with remainingMs
 */
export function startTurnTicks(code: string, onTick: OnTickCallback): void {
  const timers = timersByRoom.get(code);
  if (!timers) return;

  // If ticks are already running, do nothing (idempotent).
  if (timers.tickIntervalId !== null) return;

  const tickIntervalId = setInterval(() => {
    const elapsed = Date.now() - timers.startedAt;
    const remaining = Math.max(0, timers.durationMs - elapsed);
    onTick(remaining);

    // Stop ticking when time is up (the expiry callback will clean up everything).
    if (remaining <= 0) {
      clearInterval(tickIntervalId);
    }
  }, 1000);

  // Update the timers record with the running interval.
  timersByRoom.set(code, {
    ...timers,
    tickIntervalId,
  });
}

/**
 * Cancel all timers (expiry + ticks) for a room.
 *
 * Idempotent: calling multiple times is safe.
 * Also clears the timers record from the global map.
 *
 * @param code Room code
 */
export function cancelTurnTimers(code: string): void {
  const timers = timersByRoom.get(code);
  if (!timers) return;

  if (timers.expiryTimeoutId !== null) {
    clearTimeout(timers.expiryTimeoutId);
  }

  if (timers.tickIntervalId !== null) {
    clearInterval(timers.tickIntervalId);
  }

  timersByRoom.delete(code);
}

/**
 * Test/introspection helper: get the timers for a room (for testing).
 * Do NOT use this in production code; it's for unit tests only.
 */
export function getTimersForRoom(code: string): TurnTimers | undefined {
  return timersByRoom.get(code);
}

/**
 * Test helper: clear all timers (used in test teardown).
 */
export function clearAllTimers(): void {
  for (const code of Array.from(timersByRoom.keys())) {
    cancelTurnTimers(code);
  }
}
