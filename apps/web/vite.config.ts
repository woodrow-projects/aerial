import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev-only proxy target for the control-plane API. Defaults to a local Nest on
// :3000; override with AERIAL_DEV_PROXY to verify the SPA against a running
// station (e.g. through Caddy on :80 — `AERIAL_DEV_PROXY=http://localhost:80`).
const target = process.env.AERIAL_DEV_PROXY ?? "http://localhost:3000";

// In dev the SPA runs on :5173 and proxies API/internal calls to the control
// plane. In prod the built assets are served by the control plane (or Caddy),
// so these proxies are dev-only.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": target,
      "/internal": target,
    },
  },
  build: {
    outDir: "dist",
  },
});
