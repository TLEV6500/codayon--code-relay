import type { Component } from "solid-js";

export interface SessionEndedProps {
  readonly code: string;
  readonly onReturnToLobby: () => void;
}

/**
 * Session-ended teardown screen (FEAT-003 Task 11, REQ-037).
 *
 * Displays when the host ends the session or session terminates.
 * Features:
 * - Clear, distinct "Session Ended" view (not live editor)
 * - All host/driver controls disabled
 * - Display room code for reference
 * - "Return to Lobby" button to clear state and return to lobby
 *
 * Acceptance criteria:
 * - REQ-037.1: Show distinct 'Session Ended' screen
 * - REQ-037.2: Display session end message
 * - REQ-037.3: One "Return to Lobby" button
 * - REQ-037.4: On click, clear session state and return to App lobby view
 * - REQ-037.5: No editor or controls rendered when session ended
 */
export const SessionEnded: Component<SessionEndedProps> = (props) => {
  return (
    <div class="flex min-h-screen items-center justify-center bg-slate-950 p-6" data-testid="session-ended-view">
      <div class="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/80 p-12 shadow-2xl text-center">
        {/* Icon/Status */}
        <div class="mb-6 flex justify-center">
          <div class="rounded-full bg-amber-900/30 p-3">
            <svg
              class="h-8 w-8 text-amber-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        </div>

        {/* Heading */}
        <h1 class="text-2xl font-bold text-slate-100">Session Ended</h1>

        {/* Message */}
        <p class="mt-4 text-slate-400">
          The host has ended the session. Code editing is no longer available.
        </p>

        {/* Room Code Reference */}
        <div class="mt-6 rounded-lg bg-slate-800/50 px-4 py-3 border border-slate-700">
          <p class="text-xs text-slate-400">Room Code</p>
          <p class="mt-1 font-mono text-lg text-emerald-400">{props.code}</p>
        </div>

        {/* Return to Lobby Button */}
        <button
          class="mt-8 w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 active:bg-emerald-600 transition-colors"
          data-testid="return-to-lobby"
          onClick={props.onReturnToLobby}
        >
          Return to Lobby
        </button>

        {/* Footer hint */}
        <p class="mt-4 text-xs text-slate-600">
          You'll need a new room code to start another session
        </p>
      </div>
    </div>
  );
};
