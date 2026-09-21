/**
 * Session control panel for Host and Driver actions.
 *
 * - Host: configure turn mode/duration, start session, end session, start turn (manual mode)
 * - Driver: request early turn end (if enabled)
 * - All users: display current session state (phase, turn config, turn timer, roster status)
 */

import { createSignal, Show, type Component } from "solid-js";
import type {
  TurnConfig,
  TurnMode,
  SelectionPolicy,
} from "@codayon/shared";
import type { RelayConnection } from "../collab/transport";

export interface SessionControlsProps {
  readonly code: string;
  readonly role: "host" | "observer" | "spectator";
  readonly clientID: string;
  readonly connection: RelayConnection;
  readonly sessionPhase?: "created" | "active" | "ended";
  readonly turnConfig?: TurnConfig | null;
  readonly isCurrentDriver?: boolean;
  readonly roster?: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly connected: boolean;
  }[];
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

  return (
    <div class="flex flex-col gap-3">
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
    </div>
  );
};
