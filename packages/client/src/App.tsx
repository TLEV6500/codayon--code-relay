import { createSignal, Show, type Component } from "solid-js";
import { banner, type JoinableRole } from "@codayon/shared";
import { createRoom, joinRoom } from "./api";
import { RoomEditor } from "./components/RoomEditor";

interface Session {
  code: string;
  clientToken: string;
  clientID: string;
  role: "host" | JoinableRole;
}

const randomClientID = () =>
  `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export const App: Component = () => {
  const [session, setSession] = createSignal<Session | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [joinCode, setJoinCode] = createSignal("");
  const [name, setName] = createSignal("");

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      const res = await createRoom({
        hostName: name() || "Host",
        hostParticipation: "host-participant",
      });
      setSession({
        code: res.code,
        clientToken: res.clientToken,
        clientID: randomClientID(),
        role: "host",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to create room");
    } finally {
      setBusy(false);
    }
  }

  async function onJoin(role: JoinableRole) {
    setBusy(true);
    setError(null);
    try {
      const res = await joinRoom(joinCode().trim().toUpperCase(), {
        role,
        name: name() || (role === "spectator" ? "Spectator" : "Guest"),
      });
      setSession({
        code: res.code,
        clientToken: res.clientToken,
        clientID: randomClientID(),
        role: res.role,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to join room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="min-h-screen bg-slate-950 text-slate-100">
      <Show when={session()} fallback={<Lobby />}>
        {(s) => (
          <div class="flex h-screen flex-col">
            <header class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <span class="font-bold text-emerald-400">Codayon</span>
                <span class="ml-3 text-sm text-slate-400">
                  Room <span class="font-mono text-slate-200">{s().code}</span> ·{" "}
                  {s().role}
                </span>
              </div>
              <button
                class="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
                onClick={() => setSession(null)}
              >
                Leave
              </button>
            </header>
            <main class="min-h-0 flex-1 p-4">
              <RoomEditor
                code={s().code}
                clientToken={s().clientToken}
                clientID={s().clientID}
              />
            </main>
          </div>
        )}
      </Show>
    </div>
  );

  function Lobby() {
    return (
      <div class="flex min-h-screen items-center justify-center p-6">
        <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
          <h1 class="text-3xl font-bold tracking-tight text-emerald-400">Codayon</h1>
          <p class="mt-1 text-sm text-slate-400">Turn-based code relay</p>

          <div class="mt-6 space-y-3">
            <input
              class="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              placeholder="Your name"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />

            <button
              class="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              disabled={busy()}
              onClick={onCreate}
            >
              Create a room
            </button>

            <div class="flex items-center gap-2 py-1 text-xs text-slate-500">
              <div class="h-px flex-1 bg-slate-800" /> or join <div class="h-px flex-1 bg-slate-800" />
            </div>

            <input
              class="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm uppercase outline-none focus:border-emerald-500"
              placeholder="ROOM CODE"
              value={joinCode()}
              onInput={(e) => setJoinCode(e.currentTarget.value)}
            />
            <div class="flex gap-2">
              <button
                class="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
                disabled={busy() || !joinCode().trim()}
                onClick={() => onJoin("observer")}
              >
                Join as participant
              </button>
              <button
                class="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
                disabled={busy() || !joinCode().trim()}
                onClick={() => onJoin("spectator")}
              >
                Spectate
              </button>
            </div>
          </div>

          <Show when={error()}>
            <p class="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">
              {error()}
            </p>
          </Show>

          <p class="mt-6 font-mono text-[10px] text-slate-600">{banner()}</p>
        </div>
      </div>
    );
  }
};
