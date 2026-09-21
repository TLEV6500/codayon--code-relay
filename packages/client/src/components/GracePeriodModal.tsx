/**
 * Grace Period Modal — Host-only modal for disconnect grace period actions.
 *
 * Displays when a driver or host disconnects mid-turn, showing:
 * - Name of the disconnected participant
 * - Three actions: Reassign (host picks next driver), Extend (wait longer), Skip (move to next in rotation)
 *
 * REQ-033, Task 7: Grace period UX completion.
 */

import { createSignal, createEffect, Show, type Component } from "solid-js";
import type { RelayConnection } from "../collab/transport";

export interface GracePeriodModalProps {
  readonly graceState: {
    readonly participantId: string;
    readonly participantName: string;
    readonly gracePeriodMs: number;
    readonly startedAt: number;
  } | null;
  readonly roster?: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly connected: boolean;
  }[];
  readonly connection: RelayConnection;
  readonly isHostOnly?: boolean;
}

export const GracePeriodModal: Component<GracePeriodModalProps> = (props) => {
  const [showReassignPicker, setShowReassignPicker] = createSignal(false);
  const [remainingMs, setRemainingMs] = createSignal<number>(0);

  // Update countdown every 100ms while grace period is active
  createEffect(() => {
    if (props.graceState === null) {
      setShowReassignPicker(false);
      return;
    }

    const timer = setInterval(() => {
      const elapsed = Date.now() - props.graceState!.startedAt;
      const remaining = Math.max(0, props.graceState!.gracePeriodMs - elapsed);
      setRemainingMs(remaining);
    }, 100);

    return () => clearInterval(timer);
  });

  const formatCountdown = (ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleReassign = (driverId: string) => {
    props.connection.send({
      channel: "control",
      type: "resolveGrace",
      action: "reassign",
      newDriver: driverId,
    });
    setShowReassignPicker(false);
  };

  const handleExtend = () => {
    props.connection.send({
      channel: "control",
      type: "resolveGrace",
      action: "extend",
    });
  };

  const handleSkip = () => {
    props.connection.send({
      channel: "control",
      type: "resolveGrace",
      action: "skip",
    });
  };

  /**
   * Get eligible drivers for reassignment (connected, non-spectator, not the disconnected person).
   */
  const getEligibleDrivers = () => {
    if (!props.roster || !props.graceState) return [];
    return props.roster.filter(
      (p) =>
        p.connected &&
        (p.role === "observer" || p.role === "host-participant") &&
        p.id !== props.graceState!.participantId
    );
  };

  return (
    <Show when={props.graceState !== null && props.isHostOnly !== false}>
      <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div class="bg-slate-900 border-2 border-red-600/50 rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl" data-testid="grace-period-modal">
          {/* Header */}
          <div class="flex items-center gap-2 mb-4">
            <div class="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <h2 class="text-lg font-bold text-red-400">Grace Period Active</h2>
          </div>

          {/* Participant Info */}
          <div class="mb-4 p-3 bg-slate-800/50 rounded border border-slate-700">
            <p class="text-sm text-slate-400 mb-1">Disconnected participant:</p>
            <p class="font-semibold text-slate-100">{props.graceState?.participantName}</p>
          </div>

          {/* Countdown */}
          <div class="mb-4 text-center">
            <p class="text-xs text-slate-400 mb-1">Time remaining:</p>
            <p class={`text-2xl font-mono font-bold ${
              remainingMs() > 10000 ? "text-amber-400" :
              remainingMs() > 5000 ? "text-orange-400" :
              "text-red-400"
            }`}>
              {formatCountdown(remainingMs())}
            </p>
          </div>

          {/* Action Buttons */}
          <div class="space-y-2">
            {/* Reassign Button */}
            <button
              onClick={() => setShowReassignPicker(!showReassignPicker())}
              class="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              {showReassignPicker() ? "Cancel" : "Reassign Driver"}
            </button>

            {/* Reassign Picker Dropdown */}
            <Show when={showReassignPicker()}>
              <div class="p-2 bg-slate-800/50 border border-slate-700 rounded-lg">
                <p class="text-xs text-slate-300 mb-2 font-semibold">Select next driver:</p>
                <div class="space-y-1 max-h-40 overflow-y-auto">
                  {getEligibleDrivers().map((driver) => (
                    <button
                      onClick={() => handleReassign(driver.id)}
                      class="w-full text-left px-3 py-2 rounded text-sm bg-slate-700 hover:bg-slate-600 text-slate-100 transition-colors"
                    >
                      {driver.name}
                    </button>
                  ))}
                </div>
                <Show when={getEligibleDrivers().length === 0}>
                  <p class="text-xs text-slate-500 text-center py-2">
                    No eligible drivers available
                  </p>
                </Show>
              </div>
            </Show>

            {/* Extend Button */}
            <button
              onClick={handleExtend}
              class="w-full px-4 py-3 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              Extend Grace Period
            </button>

            {/* Skip Button */}
            <button
              onClick={handleSkip}
              class="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              Skip to Next Turn
            </button>
          </div>

          {/* Info Text */}
          <p class="mt-4 text-xs text-slate-400 text-center">
            This modal is only visible to the host.
          </p>
        </div>
      </div>
    </Show>
  );
};
