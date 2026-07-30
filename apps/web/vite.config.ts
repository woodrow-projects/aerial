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
  // Dev-mode counterpart of build.commonjsOptions below: workspace-linked
  // packages are not prebundled by default, so the browser would import the
  // raw CJS file and find no named exports.
  optimizeDeps: {
    include: ["@aerial/shared"],
  },
  build: {
    outDir: "dist",
    commonjsOptions: {
      // @aerial/shared is CJS and, as a workspace symlink, resolves OUTSIDE
      // node_modules — include it explicitly or rollup sees zero exports.
      include: [/node_modules/, /packages\/shared/],
    },
  },
});
