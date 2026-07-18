import { defineConfig } from "vitest/config";

/**
 * Unit-test harness for the control plane (ADR D14 — TDD is mandatory).
 *
 * Tests live next to the code they cover as `*.spec.ts`. They are pure unit
 * tests: no real database, no real Liquidsoap, no network — collaborators are
 * mocked. Integration/e2e suites (real engine via docker compose) are tracked
 * separately and are NOT run here.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    // env.ts captures APP_SECRET/PUBLIC_BASE_URL at import time; set them before
    // modules evaluate so the crypto + endpoint code under test has stable config.
    env: {
      APP_SECRET: "test-app-secret-at-least-32-characters-long",
      PUBLIC_BASE_URL: "https://radio.example.com",
    },
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      // Wiring-only files carry no logic worth a unit test.
      exclude: ["src/**/*.module.ts", "src/main.ts", "src/**/*.spec.ts"],
    },
  },
});
