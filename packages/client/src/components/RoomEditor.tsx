import { createSignal, onCleanup, onMount, type Component } from "solid-js";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment } from "@codemirror/state";
import type {
  SessionSnapshotMsg,
  RotationSnapshotMsg,
  TurnStartedMsg,
  ServerMessage,
  TurnConfig,
  TimerTickMsg,
  DisconnectGraceStartedMsg,
  RoleAssignedMsg,
  ControlRejectedMsg,
} from "@codayon/shared";
import { bootstrapRoom } from "../api";
import { connectRelay, type RelayConnection } from "../collab/transport";
import { peerExtension } from "../collab/peer";
import { presenceExtension } from "../collab/presence";
import {
  getLanguageExtension,
  getAllLanguages,
  type LanguageName,
} from "../collab/languages";
import { SessionControls } from "./SessionControls";

export interface RoomEditorProps {
  readonly code: string;
  readonly clientToken: string;
  readonly clientID: string;
  readonly role: "host" | "observer" | "spectator";
  readonly onSessionEnded?: () => void;
  readonly onBootstrapError?: (message: string) => void;
}

/**
 * Maps control rejection reasons to human-readable error messages.
 * Used when a control action is rejected by the server.
 */
function getControlRejectionMessage(reason: "not-host" | "not-configured" | "invalid-state"): string {
  switch (reason) {
    case "not-host":
      return "Only the host can do this";
    case "not-configured":
      return "Session not configured";
    case "invalid-state":
      return "Cannot do this now";
    default:
      return "Action not allowed";
  }
}

/**
 * Mounts a CodeMirror 6 editor bound to the room's authoritative document via
 * the collab peer. Bootstraps the start doc + version over HTTP, then keeps in
 * sync over the WebSocket relay. Also displays session controls (for hosts and drivers)
 * and roster information.
 *
 * Features:
 * - Syntax highlighting for TypeScript, JavaScript, Python, SQL, JSON, YAML,
 *   HTML, CSS, Bash, PowerShell, TOML (REQ-019, NFR-004)
 * - Language selector dropdown
 * - Session controls for host (configure, start, end) and driver (early end turn)
 * - Roster display with participant status
 * - Read-only mode for non-token-holders (REQ-013/014)
 * - Mobile-responsive canvas (NFR-003)
 */
export const RoomEditor: Component<RoomEditorProps> = (props) => {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  // NOTE: tracked as a signal (not a plain `let`) so the SessionControls
  // render below actually re-renders once the async connectRelay() in
  // onMount resolves. A plain `let` is invisible to Solid's reactivity:
  // the JSX below would evaluate `connection && (...)` exactly once during
  // the initial synchronous render (when it's still undefined) and never
  // re-run, permanently hiding SessionControls (see FEAT-004 motivation).
  const [connection, setConnection] = createSignal<RelayConnection | undefined>(undefined);
  const [language, setLanguage] = createSignal<LanguageName>("typescript");
  let languageCompartment: Compartment;

  // Session state tracking
  const [sessionPhase, setSessionPhase] = createSignal<"created" | "active" | "ended">("created");
  const [turnConfig, setTurnConfig] = createSignal<TurnConfig | null>(null);
  const [currentDriver, setCurrentDriver] = createSignal<string | null>(null);
  const [currentDriverName, setCurrentDriverName] = createSignal<string | null>(null);
  const [turnNumber, setTurnNumber] = createSignal<number | null>(null);
  const [role, setRole] = createSignal<"host" | "observer" | "spectator">(props.role);
  const [roster, setRoster] = createSignal<
    readonly {
      readonly id: string;
      readonly name: string;
      readonly role: string;
      readonly connected: boolean;
    }[]
  >([]);

  // Turn timer tracking (REQ-027)
  const [remainingMs, setRemainingMs] = createSignal<number | null>(null);

  // Round-robin rotation order tracking (REQ-031)
  const [rotationOrder, setRotationOrder] = createSignal<readonly string[]>([]);
  const [rotationNextIndex, setRotationNextIndex] = createSignal<number>(0);

  // Disconnect grace period state (REQ-033)
  interface GraceState {
    readonly participantId: string;
    readonly participantName: string;
    readonly gracePeriodMs: number;
    readonly startedAt: number;
  }
  const [graceState, setGraceState] = createSignal<GraceState | null>(null);

  // Control rejection feedback (REQ-036)
  const [controlError, setControlError] = createSignal<string | null>(null);
  let controlErrorTimeout: NodeJS.Timeout | undefined;

  onMount(async () => {
    try {
      const boot = await bootstrapRoom(props.code, props.clientToken);
      const conn = await connectRelay({
        code: props.code,
        clientToken: props.clientToken,
      });
      setConnection(conn);

      // Set initial session state from bootstrap
      setSessionPhase(boot.phase);
      setRoster(boot.roster);
      
      // Use server-confirmed role from bootstrap if available (REQ-035)
      if (boot.role) {
        setRole(boot.role);
      }

      // Strip clientToken from visible URL after successful mount (BUGFIX-006)
      window.history.replaceState({}, "", `/room/${props.code}`);

      // Subscribe to session/turn updates
      conn.onMessage((msg: ServerMessage) => {
        if (msg.channel === "control") {
          if (msg.type === "roleAssigned") {
            // Role confirmation on join/reconnect (REQ-035)
            const roleMsg = msg as RoleAssignedMsg;
          if (roleMsg.participantId === props.clientID) {
            setRole(roleMsg.role);
          }
        } else if (msg.type === "sessionSnapshot") {
          const snapshot = msg as SessionSnapshotMsg;
          setSessionPhase(snapshot.phase);
          setTurnConfig(snapshot.turnConfig);
          setRoster(snapshot.roster);
        } else if (msg.type === "rotationSnapshot") {
          const rotation = msg as RotationSnapshotMsg;
          setRotationOrder(rotation.order);
          setRotationNextIndex(rotation.nextIndex);
        } else if (msg.type === "turnStarted") {
          const turn = msg as TurnStartedMsg;
          setCurrentDriver(turn.driver);
          setCurrentDriverName(turn.driverName);
          setTurnNumber(turn.turnNumber);
          setRemainingMs(null); // Reset on new turn
        } else if (msg.type === "turnEnded") {
          setCurrentDriver(null);
          setCurrentDriverName(null);
          setTurnNumber(null);
          setRemainingMs(null); // Clear timer when turn ends
        } else if (msg.type === "timerTick") {
          // Update remaining time for interpolation in SessionControls
          const tick = msg as TimerTickMsg;
          setRemainingMs(tick.remainingMs);
        } else if (msg.type === "disconnectGraceStarted") {
          // Grace period initiated when driver/host disconnects (REQ-033, Task 7)
          const grace = msg as DisconnectGraceStartedMsg;
          setGraceState({
            participantId: grace.participantId,
            participantName: grace.participantName,
            gracePeriodMs: grace.gracePeriodMs,
            startedAt: grace.startedAt,
          });
        } else if (msg.type === "disconnectGraceResolved") {
          // Grace period resolved; clear the state (REQ-033, Task 7)
          setGraceState(null);
        } else if (msg.type === "controlRejected") {
          // Control action rejected; display human-readable feedback (REQ-036)
          const rejectionMsg = msg as ControlRejectedMsg;
          const errorText = getControlRejectionMessage(rejectionMsg.reason);
          
          // Clear any pending timeout
          if (controlErrorTimeout) {
            clearTimeout(controlErrorTimeout);
          }
          
          // Set the error message
          setControlError(errorText);
          
          // Auto-dismiss after 3 seconds (REQ-036.3)
          controlErrorTimeout = setTimeout(() => {
            setControlError(null);
          }, 3000);
        } else if (msg.type === "sessionEnded") {
          // Session has ended; transition to session-ended view (REQ-037, Task 11)
          setSessionPhase("ended");
          if (props.onSessionEnded) {
            props.onSessionEnded();
          }
        }
      }
    });

    languageCompartment = new Compartment();

    const state = EditorState.create({
      doc: boot.doc,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, monospace" },
        }),
        EditorView.editable.of(true),
        languageCompartment.of(getLanguageExtension(language())),
        peerExtension(boot.version, props.clientID, conn),
        presenceExtension(conn),
      ],
    });

    view = new EditorView({ state, parent: host });
    } catch (error) {
      // Bootstrap failed; notify parent component and return to lobby (BUGFIX-006)
      const message = error instanceof Error ? error.message : "Failed to bootstrap room";
      props.onBootstrapError?.(message);
    }
  });

  const changeLanguage = (newLang: LanguageName) => {
    setLanguage(newLang);
    if (view && languageCompartment) {
      view.dispatch({
        effects: languageCompartment.reconfigure(getLanguageExtension(newLang)),
      });
    }
  };

  onCleanup(() => {
    view?.destroy();
    connection()?.close();
  });

  return (
    <div class="flex flex-col h-full w-full gap-2 bg-slate-900">
      {/* Top control panel: language selector + session controls */}
      <div class="flex gap-2 p-2 flex-wrap">
        <div class="flex gap-2 items-center">
          <label for="language-select" class="text-sm text-slate-300">
            Language:
          </label>
          <select
            id="language-select"
            value={language()}
            onChange={(e) => changeLanguage(e.target.value as LanguageName)}
            class="px-2 py-1 rounded text-sm bg-slate-800 text-slate-100 border border-slate-600 hover:border-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {getAllLanguages().map((info) => (
              <option value={info.name}>{info.displayName}</option>
            ))}
          </select>
        </div>

        {/* Session controls (right side) */}
        <div class="ml-auto">
          {connection() && (
            <SessionControls
              code={props.code}
              role={role()}
              clientID={props.clientID}
              connection={connection()!}
              sessionPhase={sessionPhase()}
              turnConfig={turnConfig()}
              isCurrentDriver={currentDriver() === props.clientID}
              currentDriver={currentDriver()}
              currentDriverName={currentDriverName()}
              turnNumber={turnNumber()}
              roster={roster()}
              remainingMs={remainingMs()}
              rotationOrder={rotationOrder()}
              rotationNextIndex={rotationNextIndex()}
              graceState={graceState()}
              controlError={controlError()}
              onControlErrorDismiss={() => setControlError(null)}
            />
          )}
        </div>
      </div>

      {/* Editor canvas (NFR-003: responsive) */}
      <div
        ref={host}
        class="flex-1 overflow-hidden rounded-lg border border-slate-800 m-2 mt-0"
      />
    </div>
  );
};
