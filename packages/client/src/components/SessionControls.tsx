/**
 * Session control panel for Host and Driver actions.
 *
 * - Host: configure turn mode/duration, start session, end session, start turn (manual mode)
 * - Driver: request early turn end (if enabled)
 * - All users: display current session state (phase, turn config, turn timer, roster status)
 * - Grace period: host modal + all-participant countdown banner (REQ-033, Task 7)
 */

import { createSignal, createEffect, Show, type Component } from "solid-js";
import type {
  TurnConfig,
  TurnMode,
  SelectionPolicy,
} from "@codayon/shared";
import type { RelayConnection } from "../collab/transport";
import { GracePeriodModal } from "./GracePeriodModal";

export interface SessionControlsProps {
  readonly code: string;
  readonly role: "host" | "observer" | "spectator";
  readonly clientID: string;
  readonly connection: RelayConnection;
  readonly sessionPhase?: "created" | "active" | "ended";
  readonly turnConfig?: TurnConfig | null;
  readonly isCurrentDriver?: boolean;
  readonly currentDriver?: string | null;
  readonly currentDriverName?: string | null;
  readonly turnNumber?: number | null;
  readonly roster?: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly connected: boolean;
  }[];
  readonly remainingMs?: number | null;
  readonly rotationOrder?: readonly string[];
  readonly rotationNextIndex?: number;
  readonly graceState?: {
    readonly participantId: string;
    readonly participantName: string;
    readonly gracePeriodMs: number;
    readonly startedAt: number;
  } | null;
  readonly controlError?: string | null;
  readonly onControlErrorDismiss?: () => void;
}

/**
 * Session configuration dialog for the host (appears when session is in "created" phase).
 */
const ConfigurationDialog: Component<{
  readonly onConfigure: (config: TurnConfig) => void;
}> = (props) => {
  const [mode, setMode] = createSignal<TurnMode>("fixed");
  const [durationMs, setDurationMs] = createSignal(180000); // 3 minutes default
  const [policy, setPolicy] = createSignal<SelectionPolicy>("round-robin");

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-sm w-full mx-4">
        <h2 class="text-lg font-bold text-slate-100 mb-4">Configure Turns</h2>

        <div class="space-y-4">
          {/* Turn Duration */}
          <div>
            <label class="block text-sm text-slate-300 mb-2">
              Turn Duration (seconds)
            </label>
            <input
              type="number"
              min="10"
              max="600"
              step="10"
              value={durationMs() / 1000}
              onInput={(e) => setDurationMs(parseInt(e.currentTarget.value) * 1000)}
              class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Turn Mode */}
          <div>
            <label class="block text-sm text-slate-300 mb-2">Turn Mode</label>
            <select
              value={mode()}
              onChange={(e) => setMode(e.currentTarget.value as TurnMode)}
              class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="fixed">Fixed Duration</option>
              <option value="fixed-early-end">Fixed Duration (Early End Allowed)</option>
            </select>
          </div>

          {/* Selection Policy */}
          <div>
            <label class="block text-sm text-slate-300 mb-2">Driver Selection</label>
            <select
              value={policy()}
              onChange={(e) => setPolicy(e.currentTarget.value as SelectionPolicy)}
              class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="round-robin">Round-Robin (Automatic)</option>
              <option value="manual">Manual (Host Assigns)</option>
            </select>
          </div>

          {/* Action Buttons */}
          <div class="flex gap-2 pt-4">
            <button
              onClick={() =>
                props.onConfigure({
                  mode: mode(),
                  durationMs: durationMs(),
                  selectionPolicy: policy(),
                })
              }
              class="flex-1 px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded text-sm"
            >
              Start Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const SessionControls: Component<SessionControlsProps> = (props) => {
  const [showConfig, setShowConfig] = createSignal(false);
  const [rosterOpen, setRosterOpen] = createSignal(false);
  const [displayedControlError, setDisplayedControlError] = createSignal<string | null>(null);
  let controlErrorTimeout: NodeJS.Timeout | undefined;
  const [gracePeriodRemainingMs, setGracePeriodRemainingMs] = createSignal<number>(0);
  const [hostDisconnected, setHostDisconnected] = createSignal(false);
  
  // Handle control error display and auto-dismiss (REQ-036)
  createEffect(() => {
    const error = props.controlError;
    if (error) {
      setDisplayedControlError(error);
      
      // Clear any pending timeout
      if (controlErrorTimeout) {
        clearTimeout(controlErrorTimeout);
      }
      
      // Auto-dismiss after 3 seconds (REQ-036.3)
      controlErrorTimeout = setTimeout(() => {
        setDisplayedControlError(null);
        props.onControlErrorDismiss?.();
      }, 3000);
    } else {
      // Clear immediately if error is cleared externally
      setDisplayedControlError(null);
      if (controlErrorTimeout) {
        clearTimeout(controlErrorTimeout);
        controlErrorTimeout = undefined;
      }
    }
  });
  
  // Smooth countdown interpolation (REQ-027)
  const [displayMs, setDisplayMs] = createSignal<number | null>(null);
  let lastTickMs = 0;
  let lastTickTime = 0;
  let animationFrameId = 0;
  
  // Track server tick updates and interpolate between them
  createEffect(() => {
    const ms = props.remainingMs;
    if (ms !== null && ms !== undefined) {
      lastTickMs = ms;
      lastTickTime = Date.now();
      setDisplayMs(ms);
      
      // Start animation frame loop for smooth interpolation
      const animate = () => {
        const elapsed = Date.now() - lastTickTime;
        const interpolated = Math.max(0, lastTickMs - elapsed);
        setDisplayMs(interpolated);
        
        if (interpolated > 0) {
          animationFrameId = requestAnimationFrame(animate);
        } else {
          setDisplayMs(0);
        }
      };
      
      // Clear any existing animation frame
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      
      // Only start animation if we have remaining time
      if (ms > 0) {
        animationFrameId = requestAnimationFrame(animate);
      }
    } else {
      // Clear timer display when no active turn
      setDisplayMs(null);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
      }
    }
  });
  
  // Track grace period countdown (REQ-033, Task 7)
  createEffect(() => {
    if (props.graceState === null) {
      setGracePeriodRemainingMs(0);
      return;
    }

    const updateCountdown = () => {
      const elapsed = Date.now() - props.graceState!.startedAt;
      const remaining = Math.max(0, props.graceState!.gracePeriodMs - elapsed);
      setGracePeriodRemainingMs(remaining);
    };

    updateCountdown(); // Initial update
    const interval = setInterval(updateCountdown, 100);
    return () => clearInterval(interval);
  });
  
  // Track host disconnect status (REQ-034, Task 8)
  createEffect(() => {
    const host = props.roster?.find((p) => p.role === "host");
    const isHostDisconnected = host?.connected === false;
    setHostDisconnected(isHostDisconnected ?? false);
  });
  
  // Format milliseconds to MM:SS
  const formatCountdown = (ms: number | null): string => {
    if (ms === null || ms === undefined) return "--:--";
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleConfigure = (config: TurnConfig) => {
    // First send configure message
    props.connection.send({
      channel: "control",
      type: "configure",
      mode: config.mode,
      durationMs: config.durationMs,
      selectionPolicy: config.selectionPolicy,
    });

    // Then send startSession message
    setTimeout(() => {
      props.connection.send({
        channel: "control",
        type: "startSession",
      });
    }, 100);

    setShowConfig(false);
  };

  const handleEndSession = () => {
    if (confirm("End the session? This cannot be undone.")) {
      props.connection.send({
        channel: "control",
        type: "endSession",
      });
    }
  };

  const handleEarlyEnd = () => {
    props.connection.send({
      channel: "control",
      type: "earlyEnd",
    });
  };

  const handleStartTurnWithDriver = (driverId: string) => {
    props.connection.send({
      channel: "control",
      type: "startTurn",
      driver: driverId,
    });
  };

  /**
   * Get eligible drivers for manual selection:
   * - Connected participants only
   * - Non-spectators (host-participant, observer)
   * - Exclude current driver if already active turn
   */
  const getEligibleDrivers = () => {
    if (!props.roster) return [];
    return props.roster.filter(
      (p) =>
        p.connected &&
        (p.role === "observer" || p.role === "host-participant") &&
        p.id !== props.currentDriver // Don't offer current driver again
    );
  };

  /**
   * Determine if the host should see the manual driver picker.
   * Visible when:
   * - Host is not the current driver (only show when not driving)
   * - Session is active
   * - Selection policy is manual
   */
  const shouldShowDriverPicker = () => {
    const isManualMode = props.turnConfig?.selectionPolicy === "manual";
    const isHostNotDriving = props.role === "host" && !props.isCurrentDriver;
    const isSessionActive = props.sessionPhase === "active";
    return isManualMode && isHostNotDriving && isSessionActive;
  };

  /**
   * Get participant name from roster by ID.
   */
  const getParticipantName = (id: string): string => {
    const participant = props.roster?.find((p) => p.id === id);
    return participant?.name ?? id.substring(0, 8);
  };

  /**
   * Determine if rotation order should be displayed.
   * Show when:
   * - Selection policy is round-robin
   * - Session is active
   * - Rotation order exists and has participants
   */
  const shouldShowRotationOrder = () => {
    return (
      props.turnConfig?.selectionPolicy === "round-robin" &&
      props.sessionPhase === "active" &&
      props.rotationOrder &&
      props.rotationOrder.length > 0
    );
  };

  return (
    <div class="flex flex-col gap-3">
      {/* Control Rejection Feedback (REQ-036) */}
      <Show when={displayedControlError()}>
        <div class="border-l-4 border-red-500 bg-red-900/30 rounded-r-lg p-3 animate-in">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="w-2 h-2 rounded-full bg-red-500" />
              <span class="text-sm font-semibold text-red-300">{displayedControlError()}</span>
            </div>
            <button
              onClick={() => {
                setDisplayedControlError(null);
                props.onControlErrorDismiss?.();
                if (controlErrorTimeout) {
                  clearTimeout(controlErrorTimeout);
                  controlErrorTimeout = undefined;
                }
              }}
              class="text-xs text-red-400 hover:text-red-300 font-semibold"
            >
              Dismiss
            </button>
          </div>
        </div>
      </Show>

      {/* Host Disconnect Indicator (REQ-034, Task 8) */}
      <Show when={hostDisconnected()}>
        <div class="border-l-4 border-orange-500 bg-orange-900/30 rounded-r-lg p-3">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            <span class="text-sm font-semibold text-orange-300">Host Disconnected</span>
          </div>
          <p class="text-xs text-slate-400 mt-1">
            Waiting for host to reconnect...
          </p>
        </div>
      </Show>

      {/* Host Control Panel */}
      <Show when={props.role === "host"}>
        <div class="border border-slate-700 rounded-lg p-3 bg-slate-900/60">
          <h3 class="text-sm font-semibold text-emerald-400 mb-2">Host Controls</h3>

          <Show when={props.sessionPhase === "created"}>
            <button
              onClick={() => setShowConfig(true)}
              class="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-sm"
            >
              Configure & Start Session
            </button>
          </Show>

          <Show when={props.sessionPhase === "active"}>
            <button
              onClick={handleEndSession}
              class="w-full px-3 py-2 bg-red-600 hover:bg-red-500 text-white font-semibold rounded text-sm"
            >
              End Session
            </button>
          </Show>

          {/* Manual Driver Picker (REQ-030) */}
          <Show when={shouldShowDriverPicker()}>
            <div class="mt-3 pt-3 border-t border-slate-700">
              <label class="block text-xs font-semibold text-slate-300 mb-2">
                Choose Next Driver
              </label>
              <select
                onChange={(e) => {
                  if (e.currentTarget.value) {
                    handleStartTurnWithDriver(e.currentTarget.value);
                    e.currentTarget.value = ""; // Reset dropdown
                  }
                }}
                value=""
                class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
              >
                <option value="">-- Select a driver --</option>
                {getEligibleDrivers().map((driver) => (
                  <option value={driver.id}>{driver.name}</option>
                ))}
              </select>
              <Show when={getEligibleDrivers().length === 0}>
                <p class="text-xs text-slate-500 mt-1">
                  No eligible drivers available
                </p>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      {/* Driver Early-End Button */}
      <Show when={props.isCurrentDriver && props.turnConfig?.mode === "fixed-early-end"}>
        <div class="border border-slate-700 rounded-lg p-3 bg-slate-900/60">
          <button
            onClick={handleEarlyEnd}
            class="w-full px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded text-sm"
          >
            End Turn Early
          </button>
        </div>
      </Show>

      {/* Session Status */}
      <div class="border border-slate-700 rounded-lg p-3 bg-slate-900/60">
        <div class="flex justify-between items-center mb-2">
          <h3 class="text-sm font-semibold text-slate-300">Session Status</h3>
          <button
            onClick={() => setRosterOpen(!rosterOpen())}
            class="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded border border-slate-600"
          >
            {rosterOpen() ? "Hide" : "Show"} Roster
          </button>
        </div>

        <div class="space-y-1 text-xs text-slate-400">
          <div>
            <span class="text-slate-500">Phase:</span> {props.sessionPhase || "unknown"}
          </div>
          
          {/* Current driver and turn number */}
          <Show when={props.turnNumber !== null && props.turnNumber !== undefined}>
            <div class="flex items-center gap-2 px-2 py-1 bg-slate-800/50 rounded">
              <span class="text-slate-500">Turn:</span>
              <span class="font-semibold text-blue-400">#{props.turnNumber}</span>
              <span class="text-slate-600">•</span>
              <span class={props.isCurrentDriver ? "font-semibold text-emerald-400" : "text-slate-300"}>
                {props.isCurrentDriver ? "You are driving" : props.currentDriverName || "—"}
              </span>
            </div>
          </Show>
          
          {/* Turn countdown timer */}
          <Show when={displayMs() !== null}>
            <div class="flex items-center gap-2 px-2 py-1 bg-slate-800/50 rounded">
              <span class="text-slate-500">Timer:</span>
              <span class={`font-mono font-semibold ${
                displayMs()! > 10000 ? "text-emerald-400" :
                displayMs()! > 5000 ? "text-amber-400" :
                "text-red-400"
              }`}>
                {formatCountdown(displayMs())}
              </span>
            </div>
          </Show>
          
          <Show when={props.turnConfig}>
            {(config) => (
              <>
                <div>
                  <span class="text-slate-500">Duration:</span>{" "}
                  {config().durationMs / 1000}s
                </div>
                <div>
                  <span class="text-slate-500">Mode:</span> {config().mode}
                </div>
                <div>
                  <span class="text-slate-500">Selection:</span>{" "}
                  {config().selectionPolicy}
                </div>
              </>
            )}
          </Show>
        </div>

        {/* Rotation Order Display (round-robin mode) */}
        <Show when={shouldShowRotationOrder()}>
          <div class="mt-3 pt-3 border-t border-slate-800">
            <h4 class="text-xs font-semibold text-slate-300 mb-2">Rotation Order</h4>
            <div class="space-y-1">
              {props.rotationOrder?.map((participantId, index) => (
                <div
                  class={`text-xs px-2 py-1 rounded flex items-center gap-2 ${
                    index === props.rotationNextIndex
                      ? "bg-blue-900/50 border border-blue-700"
                      : "bg-slate-800/50"
                  }`}
                >
                  <span class="text-slate-500 font-mono text-xs w-5">
                    {index + 1}.
                  </span>
                  <span
                    class={
                      index === props.rotationNextIndex
                        ? "text-blue-400 font-semibold"
                        : "text-slate-300"
                    }
                  >
                    {getParticipantName(participantId)}
                  </span>
                  <Show when={index === props.rotationNextIndex}>
                    <span class="text-xs text-blue-400 ml-auto">→ next</span>
                  </Show>
                </div>
              ))}
            </div>
          </div>
        </Show>

        {/* Roster Display */}
        <Show when={rosterOpen() && props.roster}>
          {(roster) => (
            <div class="mt-3 pt-3 border-t border-slate-800">
              <h4 class="text-xs font-semibold text-slate-300 mb-2">Participants</h4>
              <div class="space-y-1">
                {roster().map((p) => (
                  <div class="text-xs text-slate-400">
                    <span
                      class={`inline-block w-2 h-2 rounded-full mr-2 ${
                        p.connected ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    {p.name} <span class="text-slate-600">({p.role})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Show>
      </div>

      {/* Configuration Dialog */}
      <Show when={showConfig()}>
        <ConfigurationDialog onConfigure={handleConfigure} />
      </Show>

      {/* Grace Period Countdown Banner (all participants) */}
      <Show when={props.graceState !== null}>
        <div class="border-l-4 border-red-500 bg-red-900/20 rounded-r-lg p-3">
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-2">
              <div class="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span class="text-sm font-semibold text-red-300">Grace Period Active</span>
            </div>
            <span class={`font-mono text-sm font-bold ${
              gracePeriodRemainingMs() > 10000 ? "text-amber-400" :
              gracePeriodRemainingMs() > 5000 ? "text-orange-400" :
              "text-red-400"
            }`}>
              {formatCountdown(gracePeriodRemainingMs())}
            </span>
          </div>
          <p class="text-xs text-slate-400">
            {props.graceState?.participantName} disconnected. Waiting for host action...
          </p>
        </div>
      </Show>

      {/* Grace Period Modal (host only) */}
      <GracePeriodModal
        graceState={props.graceState ?? null}
        roster={props.roster}
        connection={props.connection}
        isHostOnly={props.role === "host"}
      />
    </div>
  );
};
