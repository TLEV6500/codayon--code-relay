import { createSignal, onCleanup, onMount, type Component } from "solid-js";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment } from "@codemirror/state";
import type {
  SessionSnapshotMsg,
  TurnStartedMsg,
  ServerMessage,
  TurnConfig,
  TimerTickMsg,
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
  let connection: RelayConnection | undefined;
  const [language, setLanguage] = createSignal<LanguageName>("typescript");
  let languageCompartment: Compartment;

  // Session state tracking
  const [sessionPhase, setSessionPhase] = createSignal<"created" | "active" | "ended">("created");
  const [turnConfig, setTurnConfig] = createSignal<TurnConfig | null>(null);
  const [currentDriver, setCurrentDriver] = createSignal<string | null>(null);
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

  onMount(async () => {
    const boot = await bootstrapRoom(props.code);
    connection = await connectRelay({
      code: props.code,
      clientToken: props.clientToken,
    });

    // Set initial session state from bootstrap
    setSessionPhase(boot.phase);
    setRoster(boot.roster);

    // Subscribe to session/turn updates
    connection.onMessage((msg: ServerMessage) => {
      if (msg.channel === "control") {
        if (msg.type === "sessionSnapshot") {
          const snapshot = msg as SessionSnapshotMsg;
          setSessionPhase(snapshot.phase);
          setTurnConfig(snapshot.turnConfig);
          setRoster(snapshot.roster);
        } else if (msg.type === "turnStarted") {
          const turn = msg as TurnStartedMsg;
          setCurrentDriver(turn.driver);
          setRemainingMs(null); // Reset on new turn
        } else if (msg.type === "turnEnded") {
          setCurrentDriver(null);
          setRemainingMs(null); // Clear timer when turn ends
        } else if (msg.type === "timerTick") {
          // Update remaining time for interpolation in SessionControls
          const tick = msg as TimerTickMsg;
          setRemainingMs(tick.remainingMs);
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
        peerExtension(boot.version, props.clientID, connection),
        presenceExtension(connection),
      ],
    });

    view = new EditorView({ state, parent: host });
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
    connection?.close();
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
          {connection && (
            <SessionControls
              code={props.code}
              role={props.role}
              clientID={props.clientID}
              connection={connection}
              sessionPhase={sessionPhase()}
              turnConfig={turnConfig()}
              isCurrentDriver={currentDriver() === props.clientID}
              roster={roster()}
              remainingMs={remainingMs()}
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
