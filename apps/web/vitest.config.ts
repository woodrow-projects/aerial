import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Unit-test harness for the operator SPA (ADR D14 — TDD is mandatory).
 *
 * Tests live next to the code they cover as `*.spec.ts(x)`. They are pure: no
 * real control-plane, no real network — the `api` fetch layer and better-auth
 * are mocked, components render in jsdom. Presentational markup is not tested
 * exhaustively; behaviour (hooks, submit flows, redirects, brand containment)
 * is.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.spec.{ts,tsx}"],
    // Components reference Tailwind classes as plain strings; no CSS pipeline is
    // needed at test time, and skipping it keeps the suite fast and hermetic.
    css: false,
  },
});
