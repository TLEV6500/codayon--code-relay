import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

// Overridable so docker-compose's dev profile can point the proxy at the
// `server` service's Docker DNS name instead of `localhost`.
const apiTarget = process.env.VITE_PROXY_TARGET ?? "http://localhost:3000";
const wsTarget = apiTarget.replace(/^http/, "ws");

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API + WS to the relay during dev so the client uses same-origin URLs.
      "/api": { target: apiTarget, changeOrigin: true },
      "/ws": { target: wsTarget, ws: true },
    },
  },
});
