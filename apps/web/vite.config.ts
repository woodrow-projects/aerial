import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the SPA runs on :5173 and proxies API/internal calls to the
// control-plane on :3000. In prod the built assets are served by the control
// plane (or Caddy), so these proxies are dev-only.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/internal": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
