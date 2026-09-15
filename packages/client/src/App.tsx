import type { Component } from "solid-js";
import { banner } from "@codayon/shared";

export const App: Component = () => {
  return (
    <div class="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div class="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
        <h1 class="text-3xl font-bold tracking-tight text-emerald-400">
          Codayon
        </h1>
        <p class="mt-2 text-sm text-slate-400">Turn-based code relay</p>
        <p class="mt-6 rounded-lg bg-slate-800/70 px-3 py-2 font-mono text-xs text-slate-300">
          {banner()}
        </p>
      </div>
    </div>
  );
};
